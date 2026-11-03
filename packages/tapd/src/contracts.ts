import { z } from 'zod'

export const tapdId = z.string().min(1).max(100)
export const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
export const entityType = z.enum(['story', 'task', 'bug'])
export const workspaceInput = z.object({ workspaceId: tapdId }).strict()
export const schemaInput = workspaceInput.extend({ entityType: z.enum(['story', 'task']), workitemTypeId: tapdId.optional() }).strict()
export const searchInput = workspaceInput.extend({ entityType, keyword: z.string().max(500).optional(), status: tapdId.optional(), limit: z.number().int().min(1).max(200).optional(), page: z.number().int().min(1).optional(), offset: z.number().int().min(0).optional() }).strict()
export const getItemInput = workspaceInput.extend({ entityType, id: tapdId }).strict()
export const writeFields = z.object({ name: z.string().max(500).optional(), description: z.string().max(24_000).optional(), owner: z.string().max(500).optional(), begin: z.string().optional(), due: z.string().optional(), effort: z.string().optional(), status: tapdId.optional(), story_id: tapdId.optional(), iteration_id: tapdId.optional(), workitem_type_id: tapdId.optional() }).strict()
export const createItemInput = workspaceInput.extend({ entityType: z.enum(['story', 'task']), fields: writeFields, idempotencyKey: z.string().min(8).max(160), actor: z.string().min(1).max(100) }).strict()
export const updateItemInput = createItemInput.extend({ id: tapdId, expectedDigest: z.string().length(64) }).strict()
export const timesheetsInput = workspaceInput.extend({ start: dateKey, end: dateKey, entityType: z.enum(['task', 'bug']).optional(), entityId: tapdId.optional() }).strict()

/** Both the catalog JSON Schema and generic-call validation come from these schemas. */
export function operationInput(id: string) {
  if (id === 'workspaces.list') return z.object({}).strict()
  if (id === 'workspace.schema') return schemaInput
  if (id === 'timesheets.search') return timesheetsInput
  const [type, action] = id.split('.')
  if (['task', 'story', 'bug', 'timesheets'].includes(type) && action === 'count') return workspaceInput
  const schemas = { search: searchInput.omit({ entityType: true }), get: getItemInput.omit({ entityType: true }), create: createItemInput.omit({ entityType: true }), update: updateItemInput.omit({ entityType: true }) }
  if (!['task', 'story', 'bug'].includes(type) || !(action in schemas) || type === 'bug' && ['create', 'update'].includes(action)) throw new Error('OPERATION_NOT_REGISTERED')
  return schemas[action as keyof typeof schemas]
}
export const operationJsonSchema = (id: string) => z.toJSONSchema(operationInput(id))
