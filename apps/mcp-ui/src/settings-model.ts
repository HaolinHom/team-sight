export type Project = { id: string; name: string; enabled: boolean; color: string; alias?: string; order?: number; available?: boolean }
export type Member = { staffId: string; name: string; account?: string; enabled?: boolean; order?: number }
export type Settings = {
  schemaVersion: number
  teamName: string
  timeZone: 'Asia/Shanghai' | 'UTC'
  projects: Project[]
  members: Member[]
  groups: Array<{id:string;name:string;memberIds:string[];testing?:boolean}>
  defaultGroupId: string
  currentUser?: Member
  hours: { dailyRequiredHours: number; completedStates: Array<{ projectId: string; type: 'task' | 'bug'; values: string[] }> }
  chinaCalendar: { enabled: boolean; years: Record<string, unknown> }
  tapd: { baseUrl: string; defaultTypes: Array<'task' | 'bug'>; writeAccess?: { operations: Array<'create' | 'update' | 'comment'>; fields: string[] } }
  updatedAt: string
}
export type Snapshot = { revision: number; settings: Settings; credentialPresent: boolean; warning?: string }

export const categories = [
  { id: 'connection', title: 'TAPD 连接', description: '账号连接、查询内容与写入权限' },
  { id: 'projects', title: '项目配置', description: '项目、别名、颜色与顺序' },
  { id: 'members', title: '成员配置', description: '查找与管理成员身份' },
  { id: 'groups', title: '分组配置', description: '团队范围与测试人员组' },
  { id: 'hours', title: '工时配置', description: '每日规定工时与业务时区' },
  { id: 'calendar', title: '节假日与调休', description: '中国日历与缓存年份' },
  { id: 'completed', title: '完成状态', description: '项目任务与缺陷的结束状态' },
] as const
export type SettingsTarget = 'overview' | typeof categories[number]['id']
export function settingsTarget(value: unknown): SettingsTarget {
  if(value === undefined || value === 'overview') return 'overview'
  if(categories.some(item => item.id === value)) return value as SettingsTarget
  throw new Error('INVALID_SETTINGS_TARGET')
}
// Only changed fields are submitted. Nested settings are merged by the server under revision checking.
export function settingsPatch(before: Settings, after: Settings): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  for (const key of ['teamName','timeZone','projects','members','groups','defaultGroupId'] as const) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) patch[key] = after[key]
  }
  for (const key of ['hours','tapd','chinaCalendar'] as const) {
    const changed = Object.fromEntries(Object.entries(after[key]).filter(([field, value]) => JSON.stringify(value) !== JSON.stringify((before[key] as unknown as Record<string, unknown>)[field])))
    if (key === 'tapd' && changed.writeAccess) {
      changed.writeAccess = Object.fromEntries(Object.entries(after.tapd.writeAccess ?? {}).filter(([field,value]) => JSON.stringify(value) !== JSON.stringify((before.tapd.writeAccess as unknown as Record<string,unknown> | undefined)?.[field])))
    }
    if (Object.keys(changed).length) patch[key] = changed
  }
  return JSON.parse(JSON.stringify(patch))
}
