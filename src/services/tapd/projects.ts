import { tauriTransport, type TapdTransport } from './client';
import type { RawRow, TapdEnvelope } from './types';

export interface TapdProjectSummary {
  id: string;
  name: string;
  category: string;
  status: string;
}

function asString(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

/** 解析 `/workspaces/user_participant_projects` 返回（`data[].Workspace`）。 */
export function mapParticipantProjects(envelope: TapdEnvelope<unknown>): TapdProjectSummary[] {
  const data = envelope.data;
  if (!Array.isArray(data)) return [];
  return data
    .map((entry) => (entry as Record<string, unknown>)?.['Workspace'] as RawRow | undefined)
    .filter((row): row is RawRow => typeof row === 'object' && row !== null)
    .map((row) => ({
      id: asString(row.id),
      name: asString(row.name),
      category: asString(row.category),
      status: asString(row.status),
    }))
    .filter((project) => project.id.length > 0);
}

/** 排期看板只接受 project 类型，organization 为组织级空间，不作为排期项目。 */
export function isScheduleProject(project: TapdProjectSummary): boolean {
  return project.category === 'project';
}

export async function fetchUserProjects(
  transport: TapdTransport = tauriTransport
): Promise<TapdProjectSummary[]> {
  const envelope = await transport('/workspaces/user_participant_projects', {});
  if (envelope.status !== 1) {
    throw new Error(`获取项目列表失败：${envelope.info || '未知错误'}`);
  }
  return mapParticipantProjects(envelope);
}
