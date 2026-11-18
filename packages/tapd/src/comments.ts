import type { RawRow } from '@teamsight/core'
import type { EntityType } from './types.js'

export const commentEntryType = (type: EntityType): string => ({ story: 'stories', task: 'tasks', bug: 'bug' })[type]
export const commentBelongsTo = (row: RawRow, workspaceId: string, type: EntityType, id: string): boolean =>
  String(row.workspace_id) === workspaceId && String(row.entry_id) === id &&
  (row.entry_type === commentEntryType(type) || type === 'bug' && row.entry_type === 'bug_remark')

export const commentDescription = (content: string): string => '<p>' + content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/\r\n?/g, '\n').replace(/\n/g, '<br />') + '</p>'

// Missing reply IDs and TAPD's zero defaults denote the same top-level comment.
export function commentFields(row: RawRow): Record<string, string> {
  return Object.fromEntries(['workspace_id', 'entry_id', 'entry_type', 'author', 'description', 'root_id', 'reply_id'].map(key => {
    let value = String(row[key] ?? '')
    if (key === 'description') value = value.replace(/\r\n?/g, '\n').replace(/<br\s*\/?>/gi, '<br>')
    if ((key === 'root_id' || key === 'reply_id') && value === '0') value = ''
    return [key, value]
  }))
}

export function commentMaterials(row: RawRow) {
  const description = String(row.description ?? '')
  const values = (tag: string, attribute: string) => [...description.matchAll(new RegExp('<' + tag + '\\b[^>]*\\b' + attribute + '=["\']([^"\']+)["\']', 'gi'))].map(match => match[1])
  return { inlineImages: values('img', 'src'), references: values('a', 'href') }
}
