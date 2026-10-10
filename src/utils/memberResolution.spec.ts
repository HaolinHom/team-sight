import { describe, expect, it } from 'vitest';

import type { ScheduleTask } from '@/types/schedule';
import type { MemberEntry } from '@/types/settings';
import {
  createMemberResolution,
  expandTasksByMember,
  memberKeyOf,
  membersFromTasks,
  resolveTaskMembers,
  selectMembersByKeys,
} from './memberResolution';

function task(partial: Partial<ScheduleTask> & Pick<ScheduleTask, 'id'>): ScheduleTask {
  return {
    sourceType: 'task',
    title: `任务 ${partial.id}`,
    projectId: 'P1',
    projectName: '项目一',
    projectColor: '#3b82f6',
    assigneeId: null,
    assigneeName: '',
    assigneeIds: [],
    startDate: '2026-10-01',
    dueDate: '2026-10-02',
    status: 'open',
    tapdUrl: 'https://www.tapd.cn/tapd_fe/1/task/detail/1',
    ...partial,
  };
}

const MEMBERS: MemberEntry[] = [
  { staffId: '800100001', name: '张三' },
  { staffId: '800100002', name: '李四' },
];

describe('resolveTaskMembers', () => {
  it('命中多个配置成员时返回多个归属', () => {
    const resolved = resolveTaskMembers(
      task({ id: '1', assigneeIds: ['800100002', '800100001', '999'] }),
      MEMBERS
    );
    expect(resolved.map((member) => member.key)).toEqual([
      memberKeyOf('800100002'),
      memberKeyOf('800100001'),
    ]);
    expect(resolved.map((member) => member.name)).toEqual(['李四', '张三']);
  });

  it('未配置成员或负责人不在名单内时返回空', () => {
    expect(resolveTaskMembers(task({ id: '1', assigneeIds: ['999'] }), MEMBERS)).toEqual([]);
    expect(resolveTaskMembers(task({ id: '1', assigneeIds: ['800100001'] }), [])).toEqual([]);
    expect(resolveTaskMembers(task({ id: '1' }), MEMBERS)).toEqual([]);
  });
});

describe('expandTasksByMember', () => {
  it('多负责人任务在多个成员下各出现一次，并统计被隐藏的任务', () => {
    const tasks = [
      task({ id: 'a', assigneeIds: ['800100001', '800100002'] }),
      task({ id: 'b', assigneeIds: ['800100001'] }),
      task({ id: 'c', assigneeIds: ['999'] }),
      task({ id: 'd' }),
    ];

    const result = expandTasksByMember(tasks, MEMBERS);

    expect(result.tasksByMember.get(memberKeyOf('800100001'))?.map((item) => item.id)).toEqual([
      'a',
      'b',
    ]);
    expect(result.tasksByMember.get(memberKeyOf('800100002'))?.map((item) => item.id)).toEqual([
      'a',
    ]);
    expect(result.hiddenTaskCount).toBe(2);
    expect(result.namesByMember.get(memberKeyOf('800100002'))).toBe('李四');
  });

  it('未配置成员时全部隐藏', () => {
    const result = expandTasksByMember([task({ id: 'a', assigneeIds: ['800100001'] })], []);
    expect(result.tasksByMember.size).toBe(0);
    expect(result.hiddenTaskCount).toBe(1);
  });
});

describe('membersFromTasks', () => {
  it('从任务推导成员名单并按工号去重', () => {
    const members = membersFromTasks([
      task({ id: 'a', assigneeId: '800100001', assigneeName: '张三' }),
      task({ id: 'b', assigneeId: '800100001', assigneeName: '张三' }),
      task({ id: 'c', assigneeId: '800100002', assigneeName: '李四' }),
      task({ id: 'd' }),
    ]);
    expect(members).toEqual([
      { staffId: '800100001', name: '张三' },
      { staffId: '800100002', name: '李四' },
    ]);
  });
});

describe('selectMembersByKeys', () => {
  it('null 表示全选，数组表示子集，空数组表示全部取消', () => {
    expect(selectMembersByKeys(MEMBERS, null)).toHaveLength(2);
    expect(selectMembersByKeys(MEMBERS, [memberKeyOf('800100002')])).toEqual([
      { staffId: '800100002', name: '李四' },
    ]);
    expect(selectMembersByKeys(MEMBERS, [])).toEqual([]);
  });
});

describe('createMemberResolution', () => {
  it('返回成员键解析、展示名与隐藏任务数', () => {
    const tasks = [
      task({ id: 'a', assigneeIds: ['800100001'] }),
      task({ id: 'b', assigneeIds: ['999'] }),
    ];
    const resolution = createMemberResolution(tasks, selectMembersByKeys(MEMBERS, null));

    expect(resolution.memberKeysOf(tasks[0])).toEqual([memberKeyOf('800100001')]);
    expect(resolution.memberKeysOf(tasks[1])).toEqual([]);
    expect(resolution.memberNames.get(memberKeyOf('800100002'))).toBe('李四');
    expect(resolution.hiddenTaskCount).toBe(1);
  });

  it('取消勾选成员后其任务不再产生分组，隐藏计数增加', () => {
    const tasks = [
      task({ id: 'a', assigneeIds: ['800100001'] }),
      task({ id: 'b', assigneeIds: ['800100002'] }),
    ];
    const selected = selectMembersByKeys(MEMBERS, [memberKeyOf('800100001')]);
    const resolution = createMemberResolution(tasks, selected);

    expect(resolution.memberKeysOf(tasks[1])).toEqual([]);
    expect(resolution.hiddenTaskCount).toBe(1);
  });
});
