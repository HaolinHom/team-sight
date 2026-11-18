import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/server'
import { BusinessError } from './business.js'
import { StorageError } from './storage.js'
import type { TeamSightScenarios } from './scenarios.js'
import { isValidDateKey, type TeamSightSettings } from '@teamsight/core'
const id=z.string().trim().min(1).max(160)
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isValidDateKey,'Invalid business date')
const member=z.object({staffId:id,name:z.string().min(1),account:z.string().min(1).optional(),enabled:z.boolean().optional(),order:z.number().int().nonnegative().optional()}).strict()
const group=z.object({id,name:z.string().min(1),memberIds:z.array(id),testing:z.boolean().optional()}).strict()
export const publicConfigPatch=z.object({
  teamName:z.string().trim().min(1).max(80).optional(),timeZone:z.enum(['Asia/Shanghai','UTC']).optional(),
  projects:z.array(z.object({id,name:z.string().min(1),enabled:z.boolean(),color:z.string().regex(/^#[a-fA-F0-9]{6}$/),alias:z.string().optional(),order:z.number().int().nonnegative().optional(),available:z.boolean().optional()}).strict()).optional(),
  members:z.array(member).optional(),groups:z.array(group).min(1).optional(),defaultGroupId:id.optional(),
  hours:z.object({dailyRequiredHours:z.number().min(0).max(24),completedStates:z.array(z.object({projectId:id,type:z.enum(['task','bug']),values:z.array(z.string())}).strict())}).strict().optional(),
  chinaCalendar:z.object({enabled:z.boolean()}).strict().optional(),
}).strict()
const scope={scope:z.enum(['self','team']).optional(),memberIds:z.array(id).min(1).max(100).optional(),groupIds:z.array(id).min(1).optional()}
const reference=z.union([z.string().url(),z.object({workspaceId:id,entityType:z.enum(['story','task','bug']),id}).strict()])
const dependency=z.object({before:id,after:id,delivery:z.string().optional(),source:z.enum(['user','inferred']),allowSameDay:z.boolean().optional()}).strict()
export const planningSchema=z.object({
  tasks:z.array(z.object({ref:id,title:z.string().min(1),hours:z.number().finite().nonnegative(),memberIds:z.array(id).min(1).optional(),storyId:id.optional(),projectId:id.optional(),earliest:date.optional(),latest:date.optional(),originalTaskKey:id.optional()}).strict()).min(1).max(100),
  start:date.optional(),end:date.optional(),analysisDate:date.optional(),direction:z.enum(['forward','backward']).optional(),anchor:z.object({date,allowSameDay:z.boolean().optional()}).strict().optional(),
  dependencies:z.array(dependency).optional(),milestones:z.array(z.object({ref:id,date}).strict()).optional(),maxStates:z.number().int().min(1).max(50000).optional(),allowSameDay:z.boolean().optional(),memberIds:scope.memberIds,groupIds:scope.groupIds,testerMemberIds:z.array(id).optional(),
}).strict()
export function registerScenarioTools(server:McpServer,scenarios:TeamSightScenarios) {
  function add<S extends z.ZodRawShape>(name:string,description:string,schema:z.ZodObject<S>,run:(input:z.infer<z.ZodObject<S>>)=>unknown,readOnly=true) {
    server.registerTool(name,{description,inputSchema:schema,annotations:{readOnlyHint:readOnly,destructiveHint:false,openWorldHint:true}},async input=>{
      try {const value=await run(schema.parse(input));return {content:[{type:'text' as const,text:JSON.stringify(value)}],structuredContent:value as Record<string,unknown>}}
      catch(error) {const code=error instanceof BusinessError||error instanceof StorageError?error.code:error instanceof z.ZodError?'INVALID_ARGUMENTS':error instanceof RangeError?'INVALID_RANGE':'OPERATION_FAILED';const value={code,...(error instanceof BusinessError?error.details:{}),...(code==='REVISION_CONFLICT'?{current:scenarios.getConfig()}:{}),...(code==='CONFIG_REQUIRED'?{next:'teamsight_open_settings'}:{})};return {isError:true,content:[{type:'text' as const,text:JSON.stringify(value)}],structuredContent:value}}
    })
  }
  add('teamsight_get_config','Read non-secret settings, current user, identity directory, groups and default team. Discovered identities are not automatically team members.',z.object({}).strict(),()=>scenarios.getConfig())
  add('teamsight_update_config','Update non-secret configuration using expectedRevision. Token entry remains in the settings App. Members may belong to multiple groups; exactly one group is the default.',z.object({expectedRevision:z.number().int().nonnegative(),patch:publicConfigPatch}).strict(),input=>{
    const patch=input.patch as Partial<TeamSightSettings>
    if(input.patch.chinaCalendar) patch.chinaCalendar={...scenarios.getConfig().settings.chinaCalendar,...input.patch.chinaCalendar}
    return scenarios.updateConfig(input.expectedRevision,patch)
  },false)
  add('teamsight_sync_projects','Synchronize projects/current user after configuring a token. New projects are enabled; existing aliases, colors, enabled states and order are retained. New enabled projects enter the default query/write project scope; allowed write operations and fields remain unchanged.',z.object({}).strict(),()=>scenarios.syncProjects(),false)
  add('teamsight_resolve_members','Resolve self, a name, account or staff ID locally then via TAPD directories. Returns ambiguous candidates or saves a unique identity without adding it to the default group.',z.object({query:id,workspaceIds:z.array(id).optional(),selectedAccount:id.optional()}).strict(),input=>scenarios.resolveMembers(input),false)
  add('teamsight_get_requirement_context','Read a TAPD link/object, associated requirement, all child tasks, available materials and earliest scheduled testing boundary. Dependencies are reconstructed per request.',z.object({reference,testerMemberIds:z.array(id).optional(),includeHistory:z.boolean().optional(),includeMaterials:z.boolean().optional()}).strict(),input=>scenarios.requirementContext(input.reference,input))
  add('teamsight_get_work_context','Read period work facts: current items, dated actuals and source-backed period events. Self is default; team uses the default group, explicit members/groups override it. Activity gaps are explicit.',z.object({start:date,end:date,analysisDate:date.optional(),projectIds:z.array(id).optional(),...scope,includeHistory:z.boolean().optional(),refresh:z.boolean().optional()}).strict(),input=>scenarios.workContext({...input,scope:input.scope??'self'}))
  add('teamsight_plan_schedule','Calculate ordinary schedule candidates with strict daily capacity, dependencies and forward/backward anchors. Does not write TAPD. Pass originalTaskKey to release an existing task forecast without releasing actuals. Open calculationId with teamsight_open_analysis.',planningSchema,input=>scenarios.plan(input))
  add('teamsight_simulate_urgent','Read-only emergency analysis: direct single-person, reallocation before earliest testing, or multi-person collaboration. Agent supplies estimates/decomposition. No TAPD writes; incomplete search never proves infeasibility.',planningSchema.extend({mode:z.enum(['direct','reallocate','multi']),deadline:date,allowReallocation:z.boolean().optional()}).strict(),input=>scenarios.urgent(input))
  const fields=z.object({name:z.string().max(500).optional(),description:z.string().max(24000).optional(),owner:id.optional(),begin:z.string().optional(),due:z.string().optional(),effort:z.string().optional(),story_id:id.optional(),status:id.optional(),iteration_id:id.optional()}).strict()
  add('teamsight_write_tasks','Create ordinary linked tasks without dates, or apply an ordinary calculation to create/update original tasks. Stable batchKey/ref enable partial recovery. Never resends unknown writes; simulation IDs are rejected. Date writes require a fresh ordinary calculation.',z.object({batchKey:z.string().min(8).max(160),items:z.array(z.object({ref:id,workspaceId:id,id:id.optional(),expectedDigest:z.string().length(64).optional(),fields}).strict()).min(1).max(100),calculationId:id.optional(),candidateId:z.enum(['continuity','earliest']).optional(),retryFailed:z.boolean().optional()}).strict(),input=>scenarios.writeTasks(input),false)
  add('teamsight_get_task_batch','Read durable per-item task results and links; verify known unknown outcomes without resending mutations.',z.object({batchKey:z.string().min(8).max(160)}).strict(),input=>scenarios.getTaskBatch(input.batchKey))
}
