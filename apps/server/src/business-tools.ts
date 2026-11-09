import { McpServer, ResourceTemplate } from '@modelcontextprotocol/server'
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server'
import { z } from 'zod'
import { assertRange, businessDate, currentMonthRange, buildGanttDisplayTasks, filterGanttDisplayTasks, type TeamAnalysis } from '@teamsight/core'
import { operations, describeOperation, TapdError, schemaInput, searchInput, getItemInput, createItemInput, updateItemInput, timesheetsInput, workspaceInput, operationInput } from '@teamsight/tapd'
import { BusinessError, type TeamSightBusiness } from './business.js'
import type { TeamSightStore } from './storage.js'
import { generateReport, renderGantt } from './outputs.js'
import type { TeamSightScenarios } from './scenarios.js'
import type { FileRecord } from './business-storage.js'

export const ANALYSIS_UI_URI = 'ui://teamsight/analysis-0.3.3.html'
const id = z.string().min(1).max(100)
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const analysisInput = z.object({ start: date, end: date, analysisDate: date.optional(), projectIds: z.array(id).min(1).max(100).optional(), memberIds: z.array(id).min(1).max(100).optional(), groupIds: z.array(id).min(1).optional(), scope: z.enum(['self','team']).optional(), refresh: z.boolean().optional() }).strict()
const result = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }], structuredContent: value })
const artifactLinks = (artifacts: FileRecord[]) => artifacts.map(artifact => ({ type: 'resource_link' as const, uri: artifact.resourceUri, name: artifact.filename, mimeType: artifact.mimeType, size: artifact.size }))

export function analysisSummary(analysis: TeamAnalysis) {
  return { analysisId: analysis.analysisId, snapshotId: analysis.snapshotId, status: analysis.status, fetchedAt: analysis.fetchedAt, createdAt: analysis.createdAt, context: analysis.context, unit: analysis.unit,
    counts: { tasks: analysis.snapshot.tasks.length, members: analysis.members.length, risks: analysis.risks.length, issues: analysis.snapshot.issues.length },
    risks: analysis.risks.slice(0, 30), risksTruncated: analysis.risks.length > 30, limitations: analysis.limitations, resourceUri: `teamsight://artifacts/${analysis.analysisId}` }
}

export function registerBusinessTools(server: McpServer, business: TeamSightBusiness, store: TeamSightStore, html: string, scenarios: TeamSightScenarios) {
  const handlers = new Map<string, { schema: z.ZodType; run: (args: unknown) => unknown }>()
  async function safe(fn: () => unknown) {
    try {
      const value = await fn()
      if (value && typeof value === 'object' && 'artifacts' in value) return { ...result(value), content: [...result(value).content, ...artifactLinks(value.artifacts as FileRecord[])] }
      if (value && typeof value === 'object' && 'base64' in value && 'artifact' in value) return { ...result({ artifact: value.artifact }), content: [{ type: 'image' as const, mimeType: 'image/png', data: String(value.base64) }] }
      return result(value)
    }
    catch (error) {
      const code = error instanceof BusinessError ? error.code : error instanceof z.ZodError ? 'INVALID_ARGUMENTS' : error instanceof RangeError ? 'INVALID_RANGE' : error instanceof TapdError ? error.status === 401 ? 'CONFIG_REQUIRED' : error.code : 'OPERATION_FAILED'
      return { ...result({ code, ...(error instanceof BusinessError ? error.details : {}), ...(error instanceof TapdError ? { httpStatus: error.httpStatus ?? error.status, businessStatus: error.businessStatus } : {}) }), isError: true }
    }
  }
  function add<S extends z.ZodRawShape>(name: string, description: string, schema: z.ZodObject<S>, run: (args: z.infer<z.ZodObject<S>>) => unknown, readOnly = true, ui = false) {
    handlers.set(name, { schema, run: args => run(schema.parse(args)) })
    const config = { description, inputSchema: schema, annotations: { readOnlyHint: readOnly, destructiveHint: name === 'tapd_update_item', idempotentHint: readOnly || name === 'tapd_create_item' || name === 'tapd_update_item', openWorldHint: name.startsWith('tapd_') } }
    const callback = (args: unknown) => safe(() => run(schema.parse(args)))
    if (ui) registerAppTool(server, name, { ...config, _meta: { ui: { resourceUri: ANALYSIS_UI_URI } } }, callback)
    else server.registerTool(name, config, callback)
  }
  add('tapd_list_projects', 'List TAPD projects visible to the configured credential.', z.object({}).strict(), () => business.client(store.readSettings()).listProjects().then(projects => ({ projects })))
  add('tapd_get_workspace_schema', 'Read project members, supported fields and state values before a story/task mutation. Task states use the documented task schema.', schemaInput, args => {
    const snapshot = store.readSettings()
    const api = business.client(snapshot)
    business.assertProject(snapshot.settings, args.workspaceId)
    return api.workspaceSchema(args.workspaceId, args.entityType, args.workitemTypeId)
  })
  add('tapd_search_items', 'Search stories, tasks or bugs in the configured scope. Story results are excluded from hours. A full page may have further results.', searchInput, async args => {
    const snapshot = store.readSettings()
    const api = business.client(snapshot)
    business.assertProject(snapshot.settings, args.workspaceId)
    if(args.range) assertRange(args.range)
    if(args.modified) assertRange(args.modified)
    if (args.entityType === 'story') {
      const items = await api.searchRaw(args.workspaceId, 'story', args)
      return { items, partial: items.length >= (args.limit ?? 50), fetchedAt: new Date().toISOString() }
    }
    const project = snapshot.settings.projects.find(project => project.id === args.workspaceId) ?? { id: args.workspaceId, name: args.workspaceId, enabled: true, color: '#3b82f6' }
    return api.searchItems({ ...args, entityType: args.entityType }, project, Object.fromEntries(snapshot.settings.members.map(member => [member.staffId, member.name])))
  })
  add('tapd_get_item', 'Read one story/task/bug with a field digest. Use this digest as expectedDigest when updating; it reduces conflict risk without an atomic TAPD CAS guarantee.', getItemInput, args => business.readItem(args))
  add('tapd_create_item', 'Create one story or task using registered POST form fields and the configured write scope. Reuse the same idempotencyKey for retries. An unknown result must be verified before any further write.', createItemInput, args => business.write({ ...args, fields: args.fields as Record<string, string> }, 'create'), false)
  add('tapd_update_item', 'Update one story or task after reading its current digest. Uses POST, an explicit field allow-list, a durable idempotency receipt and read-back verification. Never auto-retries an emitted mutation.', updateItemInput, args => business.write({ ...args, fields: args.fields as Record<string, string> }, 'update'), false)
  add('tapd_get_operation', 'Read a persisted mutation receipt, including unknown outcomes.', z.object({ operationId: id }).strict(), args => {
    const receipt = business.files.getOperation(args.operationId)
    if (!receipt) throw new BusinessError('OPERATION_NOT_FOUND')
    business.assertProject(store.readSettings().settings, receipt.workspaceId)
    return receipt
  })
  add('tapd_verify_operation', 'Resolve an unknown mutation by reading its known or manually identified remote object. This tool only reads TAPD and never resends the mutation.', z.object({ operationId: id, candidateId: id.optional() }).strict(), args => business.verifyOperation(args.operationId, args.candidateId))
  add('tapd_list_operations', 'Discover the implemented fixed TAPD operation catalog. Unregistered methods, URLs, deletion and permissions changes are unsupported.', z.object({}).strict(), () => ({ operations }))
  add('tapd_describe_operation', 'Read method, path, form/query encoding, input schema, pagination, mapping and documentation for a registered operation.', z.object({ operationId: id }).strict(), args => {
    try { return describeOperation(args.operationId) } catch { throw new BusinessError('OPERATION_NOT_REGISTERED') }
  })
  add('tapd_call_operation', 'Call a catalog operation through the same validation and authorization as the corresponding common tool. Never accepts arbitrary paths or headers.', z.object({ operationId: id, parameters: z.record(z.string(), z.unknown()) }).strict(), args => {
    let definition
    try { definition = describeOperation(args.operationId) } catch { throw new BusinessError('OPERATION_NOT_REGISTERED') }
    if (args.operationId === 'users.current') { operationInput(args.operationId).parse(args.parameters); return business.client(store.readSettings()).currentUser() }
    if (['workspace.members','story.history','task.history','attachments.list','attachments.download_link'].includes(args.operationId)) {
      const input = operationInput(args.operationId).parse(args.parameters) as unknown as {workspaceId:string;id?:string;entryId?:string}
      business.assertProject(store.readSettings().settings,input.workspaceId)
      const api=business.client(store.readSettings())
      switch(args.operationId){case 'workspace.members':return api.members(input.workspaceId);case 'story.history':return api.storyHistory(input.workspaceId,input.id!);case 'task.history':return api.taskHistory(input.workspaceId,[input.id!]);case 'attachments.list':return api.attachments(input.workspaceId,input.entryId!);default:return api.attachmentLink(input.workspaceId,input.id!)}
    }
    const [type, action] = definition.id.split('.')
    let name: string
    let parameters = operationInput(args.operationId).parse(args.parameters) as Record<string, unknown>
    if (handlers.has(definition.id)) name = definition.id
    else if (definition.id === 'workspaces.list') name = 'tapd_list_projects'
    else if (definition.id === 'workspace.schema') name = 'tapd_get_workspace_schema'
    else {
      name = ({ search: 'tapd_search_items', get: 'tapd_get_item', create: 'tapd_create_item', update: 'tapd_update_item' } as Record<string, string>)[action]
      parameters = { ...args.parameters, entityType: type }
    }
    const handler = handlers.get(name)
    if (!handler) throw new BusinessError('OPERATION_NOT_REGISTERED')
    return handler.run(parameters)
  }, false)
  const timesheetSchema = timesheetsInput
  handlers.set('timesheets.search', { schema: timesheetSchema, run: async args => {
    const input = timesheetSchema.parse(args), snapshot = store.readSettings()
    business.assertProject(snapshot.settings, input.workspaceId)
    assertRange({ start: input.start, end: input.end })
    const params: Record<string, string> = { workspace_id: input.workspaceId, spentdate: `${input.start}~${input.end}`, is_delete: '0', include_parent_story_timesheet: '0' }
    if (input.entityType) params.entity_type = input.entityType
    if (input.entityId) params.entity_id = input.entityId
    return { ...await business.client(snapshot).pages('/timesheets', params, 'Timesheet'), unit: 'hours' }
  } })
  for (const type of ['story', 'task', 'bug', 'timesheets'] as const) {
    const schema = workspaceInput
    handlers.set(`${type}.count`, { schema, run: args => {
      const input = schema.parse(args), snapshot = store.readSettings()
      business.assertProject(snapshot.settings, input.workspaceId)
      return business.client(snapshot).count(type, input.workspaceId)
    } })
  }
  add('teamsight_get_schedule', 'Read a fully paged schedule for configured projects, with original fetch time, coverage and explicit truncation or source errors. The date-window view excludes missing dates; full member coverage is in the hours analysis.', z.object({ start: date, end: date, types: z.array(z.enum(['task', 'bug'])).min(1).optional(), refresh: z.boolean().optional() }).strict(), args => business.schedule(args))
  add('teamsight_analyze_hours', 'Build an immutable schedule/hours/risk analysis with explicit context. Returns a job when fetching exceeds the response budget; poll teamsight_get_job, then read the analysis.', analysisInput, async args => {
    const job = await business.analyzeWithBudget(args)
    return job.analysisId ? { ...analysisSummary(business.getAnalysis(job.analysisId)), jobId: job.jobId } : job
  })
  add('teamsight_start_analysis', 'Start a cancellable analysis job immediately for larger scopes.', analysisInput, args => business.startAnalysis(args))
  add('teamsight_get_job', 'Read an analysis job; interrupted jobs require a fresh analysis, never an implicit resumed write.', z.object({ jobId: id }).strict(), args => {
    const job = business.files.getJob(args.jobId)
    if (!job) throw new BusinessError('JOB_NOT_FOUND')
    return { ...job, ...(job.analysisId ? { analysis: analysisSummary(business.getAnalysis(job.analysisId)) } : {}) }
  })
  add('teamsight_cancel_job', 'Cancel queued or in-progress reads for an analysis job. Mutations cannot be cancelled through this tool.', z.object({ jobId: id }).strict(), args => business.cancelJob(args.jobId), false)
  add('teamsight_refresh_calendar', 'Refresh one China-calendar source year from the fixed official project mirrors; preserves existing cached data on failure.', z.object({ year: z.number().int().min(1000).max(9999) }).strict(), args => business.refreshCalendar(args.year), false)
  add('teamsight_read_analysis', 'Read a bounded analysis view. Page members/tasks and narrow dates as needed; full facts are also available from the analysis JSON resource.', z.object({ analysisId: id.optional(), calculationId: id.optional(), candidateId: z.string().optional(), projectIds: z.array(id).optional(), memberIds: z.array(id).optional(), riskOffset: z.number().int().min(0).optional(), memberOffset: z.number().int().min(0).optional(), taskOffset: z.number().int().min(0).optional(), start: date.optional(), end: date.optional() }).strict(), args => {
    if(!args.analysisId && !args.calculationId) throw new BusinessError('ANALYSIS_REQUIRED')
    const source = args.calculationId ? scenarios.calculationView(args.calculationId,args.candidateId) : business.getAnalysis(args.analysisId!)
    const analysis = structuredClone(source)
    const displayTasks = buildGanttDisplayTasks(source.snapshot.tasks, source.members, source.context.range, source.contributionItems)
    if(args.projectIds?.length) {
      analysis.snapshot.tasks = analysis.snapshot.tasks.filter(task=>args.projectIds!.includes(task.projectId))
      for(const member of analysis.members) {member.pending=member.pending.filter(row=>args.projectIds!.includes(row.task.projectId));for(const day of member.days) {day.contributions=day.contributions.filter(row=>args.projectIds!.includes(row.projectId));day.actual=day.contributions.reduce((sum,row)=>sum+row.actual,0);day.allocated=day.contributions.reduce((sum,row)=>sum+row.allocated,0);day.total=day.actual+(day.basis==='forecast'?day.allocated:0);day.deficit=Math.max(day.target-day.total,0)}}
    }
    if(args.memberIds?.length) {analysis.members=analysis.members.filter(member=>args.memberIds!.includes(member.member.staffId));analysis.snapshot.tasks=analysis.snapshot.tasks.filter(task=>task.assigneeIds.some(id=>args.memberIds!.includes(id)))}
    const memberOffset = args.memberOffset ?? 0, taskOffset = args.taskOffset ?? 0
    const start = args.start ?? analysis.context.range.start, end = args.end ?? analysis.context.range.end
    assertRange({ start, end })
    if (start < analysis.context.range.start || end > analysis.context.range.end || start > end) throw new BusinessError('VIEW_OUTSIDE_ANALYSIS')
    const visibleTasks = filterGanttDisplayTasks(displayTasks, { start, end }, args.memberIds, args.projectIds)
    analysis.risks=analysis.risks.filter(risk=>(!risk.date||risk.date>=start&&risk.date<=end)&&(!args.memberIds?.length||!risk.staffId||args.memberIds.includes(risk.staffId))&&(!args.projectIds?.length||!risk.taskKey||args.projectIds.some(project=>risk.taskKey!.startsWith(project+':'))))
    analysis.context={...analysis.context,range:{start,end}}
    return { ...analysisSummary(analysis), ...(source.calendar === undefined ? {} : { calendar: Object.fromEntries(Object.entries(source.calendar).filter(([date]) => date >= start && date <= end)) }), risks:analysis.risks.slice(args.riskOffset??0,(args.riskOffset??0)+30),risksTruncated:analysis.risks.length>(args.riskOffset??0)+30,sourceContext:source.context, viewFilters:{projectIds:args.projectIds,memberIds:args.memberIds,start,end}, calculationId: args.calculationId, candidateId: args.candidateId, members: analysis.members.slice(memberOffset, memberOffset + 20).map(member => ({ ...member, days: member.days.filter(day => day.date >= start && day.date <= end), pending: member.pending.slice(0, 50), pendingCount: member.pending.length, pendingTruncated: member.pending.length > 50 })),
      counts: { ...analysisSummary(analysis).counts, tasks: visibleTasks.length }, tasks: visibleTasks.slice(taskOffset, taskOffset + 200), issues: analysis.snapshot.issues.slice(0, 100),
      nextMemberOffset: analysis.members.length > memberOffset + 20 ? memberOffset + 20 : null, nextTaskOffset: visibleTasks.length > taskOffset + 200 ? taskOffset + 200 : null }
  })
  add('teamsight_check_risks', 'Read explainable risk findings from one saved analysis. Includes the open day under MCP hours rules; partial sources and unscanned unassigned items remain explicit.', z.object({ analysisId: id, offset: z.number().int().min(0).optional() }).strict(), args => {
    const analysis = business.getAnalysis(args.analysisId), offset = args.offset ?? 0
    return { ...analysisSummary(analysis), risks: analysis.risks.slice(offset, offset + 100), nextOffset: analysis.risks.length > offset + 100 ? offset + 100 : null }
  })
  add('teamsight_open_analysis', 'Open a focused Gantt result card with only task/hours mode switching. Set people, projects and dates in conversation. Reuse analysisId for the same facts; without an ID, automatically analyzes the default team for the current month. Simulation candidates and baseline are chosen in conversation.', z.object({ analysisId: id.optional(), calculationId: id.optional(), candidateId: z.string().optional(), baseline: z.boolean().optional(), mode: z.enum(['tasks','hours']).optional(), memberIds: z.array(id).min(1).optional(), projectIds: z.array(id).min(1).optional(), start: date.optional(), end: date.optional() }).strict(), async args => {
    const presentation = { mode: args.mode ?? 'tasks', viewFilters: { memberIds: args.memberIds, projectIds: args.projectIds, start: args.start, end: args.end } }
    const validateView = (analysis: TeamAnalysis) => {
      const range = { start: args.start ?? analysis.context.range.start, end: args.end ?? analysis.context.range.end }
      assertRange(range)
      if(range.start < analysis.context.range.start || range.end > analysis.context.range.end) throw new BusinessError('VIEW_OUTSIDE_ANALYSIS')
      return { ...analysisSummary(analysis), ...presentation }
    }
    if(args.calculationId) {
      const calculation=scenarios.getCalculation(args.calculationId)
      if(args.baseline) return { ...validateView(business.getAnalysis(calculation.analysisId)), baseline: true, simulation: { mode: calculation.mode } }
      return {...validateView(scenarios.calculationView(args.calculationId,args.candidateId)), calculationId:args.calculationId,candidateId:args.candidateId,simulation:{mode:calculation.mode}}
    }
    if(args.analysisId) return validateView(business.getAnalysis(args.analysisId))
    const snapshot = store.readSettings(), today = businessDate(snapshot.settings.timeZone), range = currentMonthRange(new Date(today+'T12:00:00Z'))
    const job = await business.analyzeWithBudget({ start: args.start ?? range.start, end: args.end ?? range.end, analysisDate: today, scope:'team', memberIds:args.memberIds, projectIds:args.projectIds })
    return job.analysisId ? validateView(business.getAnalysis(job.analysisId)) : { ...job, ...presentation }
  }, true, true)
  add('teamsight_render_gantt', 'Render a saved analysis as paginated Chinese SVG, PNG or HTML. Every output references the same analysis and snapshot.', z.object({ analysisId: id, format: z.enum(['svg', 'png', 'html']).default('png') }).strict(), args => ({ artifacts: renderGantt(business.getAnalysis(args.analysisId), business.files, args.format) }), false)
  add('teamsight_generate_report', 'Generate the fixed interval hours/current schedule/risk report from a saved analysis, as Markdown, safe HTML, CSV or complete facts JSON.', z.object({ analysisId: id, format: z.enum(['markdown', 'html', 'csv', 'json']).default('markdown') }).strict(), args => ({ artifacts: [generateReport(business.getAnalysis(args.analysisId), business.files, args.format)] }), false)
  add('teamsight_read_artifact', 'Read an artifact by ID. Text uses character offsets and a bounded chunk; PNG is returned as base64. Resources use teamsight://artifacts/{id}.', z.object({ artifactId: id, offset: z.number().int().min(0).default(0), maxChars: z.number().int().min(1).max(48_000).default(24_000) }).strict(), args => {
    const meta = business.files.getFile(args.artifactId), bytes = business.files.readFile(args.artifactId)
    if (meta.mimeType === 'image/png') return { artifact: meta, base64: bytes.toString('base64') }
    const text = bytes.toString('utf8')
    return { artifact: meta, text: text.slice(args.offset, args.offset + args.maxChars), nextOffset: text.length > args.offset + args.maxChars ? args.offset + args.maxChars : null }
  })
  server.registerResource('TeamSight artifact', new ResourceTemplate('teamsight://artifacts/{artifactId}', { list: undefined }), { description: 'Immutable analysis JSON and rendered files; accessible through MCP without local filesystem access.' }, async (uri, variables) => {
    const artifactId = String(variables.artifactId), meta = business.files.getFile(artifactId), bytes = business.files.readFile(artifactId)
    return { contents: [meta.mimeType === 'image/png' ? { uri: uri.href, mimeType: meta.mimeType, blob: bytes.toString('base64') } : { uri: uri.href, mimeType: meta.mimeType, text: bytes.toString('utf8') }] }
  })
  for(const uri of [ANALYSIS_UI_URI]) registerAppResource(server, 'TeamSight analysis '+uri, uri, { description: 'Focused task/hours Gantt result card', _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] } } } }, () => ({ contents: [{ uri, mimeType: RESOURCE_MIME_TYPE, text: html, _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] } } } }] }))
}
