import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));
vi.mock('@/services/settings', () => ({ loadSettings: mocks.load, saveSettings: mocks.save }));

let store: ReturnType<typeof import('./useSettings')['useSettings']>;
const SETTINGS = {
  schemaVersion: 1,
  projects: [{ id: '1', name: '项目', enabled: true, color: '#3b82f6' }],
  members: [{ staffId: '100', name: '成员' }],
  updatedAt: '',
};

beforeEach(async () => {
  vi.resetModules();
  mocks.load.mockReset().mockResolvedValue({ settings: structuredClone(SETTINGS) });
  mocks.save.mockReset().mockResolvedValue(undefined);
  store = (await import('./useSettings')).useSettings();
  await store.load();
});

describe('配置保存一致性', () => {
  it('成员排序在保存成功后发布，新增和删除保留已有相对顺序', async () => {
    await store.addMembers([{ staffId: '200', name: '乙' }, { staffId: '300', name: '丙' }]);
    let finish!: () => void;
    mocks.save.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    const moving = store.moveMember('300', '100', 'before');
    await Promise.resolve();
    expect(store.settings.value.members.map(member => member.staffId)).toEqual(['100', '200', '300']);
    finish();
    expect(await moving).toBe(true);
    expect(store.settings.value.members.map(member => member.staffId)).toEqual(['300', '100', '200']);
    await store.moveMember('300', '200', 'after');
    await store.addMembers([{ staffId: '400', name: '丁' }]);
    await store.removeMember('200');
    expect(store.settings.value.members.map(member => member.staffId)).toEqual(['100', '300', '400']);
  });

  it('排序失败保留原顺序且不阻断后续保存', async () => {
    await store.addMembers([{ staffId: '200', name: '乙' }]);
    mocks.save.mockRejectedValueOnce(new Error('磁盘写入失败'));
    expect(await store.moveMember('200', '100', 'before')).toBe(false);
    expect(store.settings.value.members.map(member => member.staffId)).toEqual(['100', '200']);
    expect(store.saveError.value).toContain('磁盘写入失败');
    expect(await store.moveMember('200', '100', 'before')).toBe(true);
    expect(store.settings.value.members.map(member => member.staffId)).toEqual(['200', '100']);
    expect(store.saveError.value).toBe('');
  });

  it('排序与删除串行执行，已移除成员、自身及位置不变时不写入', async () => {
    await store.addMembers([{ staffId: '200', name: '乙' }, { staffId: '300', name: '丙' }]);
    await Promise.all([store.moveMember('300', '100', 'before'), store.removeMember('100')]);
    expect(store.settings.value.members.map(member => member.staffId)).toEqual(['300', '200']);
    mocks.save.mockClear();
    await store.moveMember('100', '200', 'before');
    await store.moveMember('200', '100', 'after');
    await store.moveMember('200', '200', 'after');
    await store.moveMember('300', '200', 'before');
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it.each(['addProject', 'updateProject', 'removeProject', 'addMembers', 'removeMember'])('%s保存失败不改变已确认配置', async (operation) => {
    mocks.save.mockRejectedValueOnce(new Error('磁盘写入失败'));
    if (operation === 'addProject') expect(await store.addProject({ id: '2', name: '新增' })).toBe(false);
    if (operation === 'updateProject') await store.updateProject('1', { enabled: false });
    if (operation === 'removeProject') await store.removeProject('1');
    if (operation === 'addMembers') expect(await store.addMembers([{ staffId: '200', name: '新增' }])).toBe(0);
    if (operation === 'removeMember') await store.removeMember('100');
    expect(store.settings.value).toEqual(SETTINGS);
    expect(store.saveError.value).toContain('磁盘写入失败');
  });

  it('保存成功前不发布内存状态，连续操作基于已保存结果串行写入', async () => {
    let finish!: () => void;
    mocks.save.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    const first = store.updateProject('1', { enabled: false });
    const second = store.updateProject('1', { color: '#ff0000' });
    await Promise.resolve();
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(store.settings.value.projects[0].enabled).toBe(true);
    finish();
    await Promise.all([first, second]);
    expect(mocks.save).toHaveBeenCalledTimes(2);
    expect(mocks.save.mock.calls[1][0].projects[0]).toMatchObject({ enabled: false, color: '#ff0000' });
    expect(store.settings.value.projects[0]).toMatchObject({ enabled: false, color: '#ff0000' });
  });

  it('一次失败不阻塞后续保存，后续成功清除错误', async () => {
    mocks.save.mockRejectedValueOnce(new Error('写入失败'));
    const first = store.updateProject('1', { enabled: false });
    const second = store.addMembers([{ staffId: '200', name: '新增' }]);
    await Promise.all([first, second]);
    expect(store.settings.value.projects[0].enabled).toBe(true);
    expect(store.settings.value.members).toHaveLength(2);
    expect(store.saveError.value).toBe('');
  });
});
