import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHoursSettings } from '@/hours/settings';
import type { HoursSnapshot } from '@/types/hours';
import type { HoursQuery } from '@/services/tapd/hours';
const mocks=vi.hoisted(()=>({fetch:vi.fn()}));
vi.mock('@/services/tapd/hours',()=>({fetchHoursSnapshot:mocks.fetch}));
import { useHours, hoursQueryKey } from './useHours';
const query:HoursQuery={projects:[],members:[],range:{start:'2026-10-12',end:'2026-10-14'},today:'2026-10-14',settings:createHoursSettings()};
const result:HoursSnapshot={tasks:[],records:[],issues:[],status:'complete'};
beforeEach(()=>{mocks.fetch.mockReset().mockResolvedValue(result);});
describe('工时加载一致性',()=>{
 it('只允许最新请求提交成功或失败',async()=>{
  let resolveOld!:(value:HoursSnapshot)=>void;
  mocks.fetch.mockImplementationOnce(()=>new Promise<HoursSnapshot>(resolve=>{resolveOld=resolve;}));
  const store=useHours();const old=store.refresh(query);const next={...query,range:{start:'2026-11-01',end:'2026-11-30'}};
  await store.refresh(next);resolveOld({...result,status:'failed',issues:[{projectId:'p',affects:'both',message:'旧请求失败'}]});await old;
  expect(store.loadedKey.value).toBe(hoursQueryKey(next));expect(store.error.value).toBe('');expect(store.loading.value).toBe(false);
 });
 it('同范围失败保留旧数据及成功时间，不同范围由键区分',async()=>{
  const store=useHours();await store.refresh(query);const time=store.lastLoadedAt.value;
  mocks.fetch.mockRejectedValueOnce(new Error('网络失败'));await store.refresh({...query,range:{start:'2026-11-01',end:'2026-11-30'}});
  expect(store.snapshot.value).toEqual(result);expect(store.stale.value).toBe(true);expect(store.lastLoadedAt.value).toBe(time);expect(store.loadedKey.value).toBe(hoursQueryKey(query));
 });
 it('失效后的请求不能提交，调用参数为冻结副本',async()=>{
  let finish!:(value:HoursSnapshot)=>void;mocks.fetch.mockImplementationOnce(()=>new Promise<HoursSnapshot>(resolve=>{finish=resolve;}));
  const store=useHours();const local={...query,range:{...query.range}};const request=store.refresh(local);local.range.end='2026-12-31';store.invalidate();finish(result);await request;
  expect(mocks.fetch.mock.calls[0][0].range.end).toBe('2026-10-14');expect(store.snapshot.value).toBeNull();
 });
 it('修改目标或日历无需重取数据，修改终态需要重取累计',()=>{
  expect(hoursQueryKey({...query,settings:{...query.settings,dailyRequiredHours:7.5,exemptions:[{staffId:'1',date:'2026-10-14',note:''}]}})).toBe(hoursQueryKey(query));
  expect(hoursQueryKey({...query,settings:{...query.settings,completedStates:[{projectId:'p',type:'task',values:['已验收']}]}})).not.toBe(hoursQueryKey(query));
 });
});
