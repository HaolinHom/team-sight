import type { EntityType } from './types.js'
import { operationJsonSchema } from './contracts.js'

const docs = 'https://open.tapd.cn/document/api-doc/API文档/api_reference/'
export const entityPath = (type: EntityType): string => ({ story: '/stories', task: '/tasks', bug: '/bugs' })[type]
export const entityKey = (type: EntityType): string => ({ story: 'Story', task: 'Task', bug: 'Bug' })[type]
export const writableFields = ['name', 'description', 'owner', 'begin', 'due', 'effort', 'status', 'story_id', 'iteration_id', 'workitem_type_id'] as const
export interface OperationDefinition {
  id: string
  method: 'GET' | 'POST'
  path: string
  kind: 'read' | 'write'
  encoding: 'query' | 'form'
  pagination: 'page-200-max-50' | 'none'
  responseKey: string
  documentation: string
  support: 'implemented'
  inputSchema: Record<string, unknown>
}
export const operations: OperationDefinition[] = [
  { id: 'workspaces.list', path: '/workspaces/user_participant_projects', responseKey: 'Workspace', documentation: docs + 'workspace/get_user_participant_projects.html', inputSchema: operationJsonSchema('workspaces.list') },
  { id: 'workspace.schema', path: '/stories/get_fields_info + /tasks/custom_fields_settings + /workspaces/users', responseKey: 'metadata', documentation: docs + 'story/get_story_fields_info.html', inputSchema: operationJsonSchema('workspace.schema') },
  ...(['story', 'task', 'bug'] as EntityType[]).flatMap(type => [
    { id: `${type}.search`, path: entityPath(type), responseKey: entityKey(type), documentation: docs + `${type === 'story' ? 'story/get_stories' : type === 'task' ? 'task/get_tasks' : 'bug/get_bugs'}.html`, inputSchema: operationJsonSchema(`${type}.search`) },
    { id: `${type}.get`, path: entityPath(type), responseKey: entityKey(type), documentation: docs + `${type === 'story' ? 'story/get_stories' : type === 'task' ? 'task/get_tasks' : 'bug/get_bugs'}.html`, inputSchema: operationJsonSchema(`${type}.get`) },
  ]),
].map(entry => ({ ...entry, method: 'GET', kind: 'read', encoding: 'query', pagination: entry.id.endsWith('.search') ? 'page-200-max-50' : 'none', support: 'implemented' })) as OperationDefinition[]
operations.push({ id: 'timesheets.search', method: 'GET', path: '/timesheets', kind: 'read', encoding: 'query', pagination: 'page-200-max-50', responseKey: 'Timesheet', documentation: docs + 'timesheet/get_timesheets.html', support: 'implemented',
  inputSchema: operationJsonSchema('timesheets.search') })
for (const type of ['story', 'task', 'bug', 'timesheets'] as const) operations.push({ id: `${type}.count`, method: 'GET', path: type === 'timesheets' ? '/timesheets/count' : `${entityPath(type)}/count`, kind: 'read', encoding: 'query', pagination: 'none', responseKey: 'count', documentation: docs, support: 'implemented', inputSchema: operationJsonSchema(`${type}.count`) })
for (const type of ['story', 'task'] as const) for (const action of ['create', 'update'] as const) operations.push({
  id: `${type}.${action}`, method: 'POST', path: entityPath(type), responseKey: entityKey(type), kind: 'write', encoding: 'form', pagination: 'none', support: 'implemented',
  documentation: docs + `${type}/${action === 'create' ? 'add' : 'update'}_${type}.html`,
  inputSchema: operationJsonSchema(`${type}.${action}`),
})

export function describeOperation(id: string): OperationDefinition {
  const entry = operations.find(operation => operation.id === id)
  if (!entry) throw new Error('OPERATION_NOT_REGISTERED')
  return entry
}
