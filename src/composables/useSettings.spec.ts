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
