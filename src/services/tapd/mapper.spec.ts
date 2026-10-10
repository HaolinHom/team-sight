import { describe, expect, it } from 'vitest';

import {
  buildTapdUrl,
  dedupeTasks,
  mapRow,
  mapWorkspaceUsers,
  normalizeDateKey,
  parseAssignee,
} from './mapper';
import type { ProjectConfig } from '@/types/schedule';

const PROJECT: ProjectConfig = {
  id: '63253157',
  name: '中台项目',
  enabled: true,
  color: '#3b82f6',
};

describe('parseAssignee', () => {
  it('解析任务的 姓名_工号; 格式并按分号拆分多人', () => {
    expect(parseAssignee('吴亿鑫_800164110;')).toEqual({ id: '800164110', name: '吴亿鑫' });
    expect(parseAssignee('张三_800100001;李四_800100002;')).toEqual({
      id: '800100001',
      name: '张三',
    });
  });

  it('解析缺陷的 姓名_工号 格式（无尾分号）', () => {
    expect(parseAssignee('蔡宏炯_800170307')).toEqual({ id: '800170307', name: '蔡宏炯' });
  });

  it('空负责人返回空结果，不臆造姓名', () => {
    expect(parseAssignee('')).toEqual({ id: null, name: '' });
    expect(parseAssignee(null)).toEqual({ id: null, name: '' });
    expect(parseAssignee('   ')).toEqual({ id: null, name: '' });
  });

  it('无工号时保留姓名、不生成 ID', () => {
    expect(parseAssignee('张三')).toEqual({ id: null, name: '张三' });
  });
});

describe('normalizeDateKey', () => {
  it('兼容日期时间前缀', () => {
    expect(normalizeDateKey('2026-10-09')).toBe('2026-10-09');
    expect(normalizeDateKey('2026-10-09 12:30:00')).toBe('2026-10-09');
  });

  it('空值与非法值返回 null，不做推算', () => {
    expect(normalizeDateKey(null)).toBeNull();
    expect(normalizeDateKey('')).toBeNull();
    expect(normalizeDateKey('2026-02-30')).toBeNull();
    expect(normalizeDateKey('0000-00-00')).toBeNull();
  });
});

describe('mapRow', () => {
  it('映射任务字段，标题取 name、负责人取 owner', () => {
    const mapped = mapRow(
      {
        id: '9001',
        name: '用户登录改造',
        owner: '张三_800100001;',
        status: 'open',
        priority_label: 'High',
        begin: '2026-10-01',
        due: '2026-10-08',
      },
      PROJECT,
      'task'
    );

    expect(mapped).toMatchObject({
      id: '9001',
      sourceType: 'task',
      title: '用户登录改造',
      assigneeId: '800100001',
      assigneeName: '张三',
      startDate: '2026-10-01',
      dueDate: '2026-10-08',
      priority: 'High',
      tapdUrl: 'https://www.tapd.cn/63253157/task/view/9001',
    });
  });

  it('映射缺陷字段，标题取 title、负责人取 current_owner', () => {
    const mapped = mapRow(
      { id: '7001', title: '列表分页异常', current_owner: '蔡宏炯_800170307', status: 'closed' },
      PROJECT,
      'bug'
    );

    expect(mapped).toMatchObject({
      id: '7001',
      sourceType: 'bug',
      title: '列表分页异常',
      assigneeId: '800170307',
      assigneeName: '蔡宏炯',
      startDate: null,
      dueDate: null,
      tapdUrl: 'https://www.tapd.cn/63253157/bug/view/7001',
    });
  });

  it('缺少 id 的行直接丢弃', () => {
    expect(mapRow({ name: '无 ID' }, PROJECT, 'task')).toBeNull();
  });

  it('用成员目录中的姓名覆盖负责人显示名', () => {
    const mapped = mapRow(
      { id: '9002', name: 'A', owner: '张3_800100001;' },
      PROJECT,
      'task',
      { '800100001': '张三' }
    );
    expect(mapped?.assigneeName).toBe('张三');
  });

  it('标题缺失时给出可辨识占位，不臆造业务标题', () => {
    const mapped = mapRow({ id: '9003' }, PROJECT, 'task');
    expect(mapped?.title).toBe('(无标题)');
  });
});

describe('mapWorkspaceUsers', () => {
  it('建立 工号 -> 姓名 索引', () => {
    const directory = mapWorkspaceUsers([
      { user: '陈伟波_800119650', name: '陈伟波' },
      { user: '欧树贤_800131600', name: '欧树贤' },
    ]);

    expect(directory).toEqual({ '800119650': '陈伟波', '800131600': '欧树贤' });
  });
});

describe('dedupeTasks', () => {
  it('按 来源类型 + ID 去重，同时保留同号的 task 与 bug', () => {
    const base = {
      title: 'A',
      projectId: 'P',
      projectName: 'P',
      projectColor: '#000',
      assigneeId: null,
      assigneeName: '',
      startDate: '2026-10-01',
      dueDate: '2026-10-02',
      status: 'open',
      tapdUrl: 'https://example.com',
    };

    const result = dedupeTasks([
      { ...base, id: '1', sourceType: 'task' },
      { ...base, id: '1', sourceType: 'task' },
      { ...base, id: '1', sourceType: 'bug' },
    ]);

    expect(result).toHaveLength(2);
    expect(result.map((item) => item.sourceType)).toEqual(['task', 'bug']);
  });
});

describe('buildTapdUrl', () => {
  it('按工作项类型生成任务/缺陷详情地址', () => {
    expect(buildTapdUrl('62120799', 'task', '123')).toBe(
      'https://www.tapd.cn/62120799/task/view/123'
    );
    expect(buildTapdUrl('62120799', 'bug', '456')).toBe(
      'https://www.tapd.cn/62120799/bug/view/456'
    );
  });
});
