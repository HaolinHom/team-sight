import { describe, expect, it } from 'vitest';

import { isScheduleProject, mapParticipantProjects } from './projects';
import type { TapdEnvelope } from './types';

const ENVELOPE: TapdEnvelope<unknown> = {
  status: 1,
  info: 'success',
  data: [
    {
      Workspace: {
        id: '63253157',
        name: '巨像销售中台产品线',
        category: 'project',
        status: 'normal',
      },
    },
    { Workspace: { id: '31936863', name: '快尚时装', category: 'organization', status: 'normal' } },
    { Workspace: { name: '缺少 ID', category: 'project' } },
  ],
};

describe('mapParticipantProjects', () => {
  it('解析项目条目并丢弃缺少 ID 的记录', () => {
    const projects = mapParticipantProjects(ENVELOPE);
    expect(projects).toEqual([
      { id: '63253157', name: '巨像销售中台产品线', category: 'project', status: 'normal' },
      { id: '31936863', name: '快尚时装', category: 'organization', status: 'normal' },
    ]);
  });

  it('非数组 data 返回空列表', () => {
    expect(mapParticipantProjects({ status: 1, info: 'success', data: '' })).toEqual([]);
  });
});

describe('isScheduleProject', () => {
  it('只接受 project 类型', () => {
    expect(isScheduleProject({ id: '1', name: 'A', category: 'project', status: 'normal' })).toBe(
      true
    );
    expect(isScheduleProject({ id: '2', name: 'B', category: 'organization', status: 'normal' })).toBe(
      false
    );
  });
});
