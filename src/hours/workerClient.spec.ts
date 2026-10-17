import { describe, expect, it, vi } from 'vitest';
import { createHoursCalculator } from './workerClient';
import { createHoursSettings } from './settings';
import type { HoursWorkerRequest } from './workerProtocol';
const input = { snapshot: { tasks: [], records: [], issues: [], status: 'complete' as const }, members: [], settings: createHoursSettings(), range: { start: '2026-10-01', end: '2026-10-31' }, today: '2026-10-14' };
function setup() {
 const workers: Array<{ onmessage: Worker['onmessage']; onerror: Worker['onerror']; onmessageerror: Worker['onmessageerror']; postMessage: ReturnType<typeof vi.fn>; terminate: ReturnType<typeof vi.fn> }> = [];
 const factory = () => { const worker = { onmessage: null, onerror: null, onmessageerror: null, postMessage: vi.fn(), terminate: vi.fn() }; workers.push(worker); return worker as unknown as Worker; };
 const calculator = createHoursCalculator(factory);
 const finish = (index: number, rows = []) => { const worker = workers[index]; const request = worker.postMessage.mock.calls.at(-1)![0] as HoursWorkerRequest; worker.onmessage?.call(worker as unknown as Worker, { data: { id: request.id, rows, calculationMs: 1 } } as MessageEvent); };
 return { calculator, workers, finish };
}
describe('后台工时计算生命周期', () => {
 it('只有完成消息才提交结果，规则重算复用快照', async () => {
  const {calculator,workers,finish}=setup();const first=calculator.calculate(input);expect(workers[0].postMessage.mock.calls[0][0].snapshot).toBe(input.snapshot);finish(0);await first;
  const second=calculator.calculate({...input,settings:{...input.settings,dailyRequiredHours:7.5}});expect(workers).toHaveLength(1);expect(workers[0].postMessage.mock.calls[1][0].snapshot).toBeUndefined();finish(0);await second;
 });
 it('日历重算传递新规则并复用已有快照', async () => {
  const {calculator,workers,finish}=setup();const first=calculator.calculate(input);finish(0);await first;
  const calendar={'2026-10-10':{working:true,name:'国庆补班'}};
  const second=calculator.calculate({...input,calendar});const request=workers[0].postMessage.mock.calls[1][0] as HoursWorkerRequest;
  expect(request.snapshot).toBeUndefined();expect(request.input.calendar).toEqual(calendar);finish(0);await second;
 });
 it('新计算终止旧任务，旧结果不提交', async () => {
  const {calculator,workers,finish}=setup();const old=calculator.calculate(input);const rejected=expect(old).rejects.toMatchObject({name:'AbortError'});const next=calculator.calculate(input);expect(workers[0].terminate).toHaveBeenCalledOnce();finish(0);finish(1);await rejected;expect((await next).calculationMs).toBe(1);
 });
 it('Worker失败明确反馈，随后可以重试', async () => {
  const {calculator,workers,finish}=setup();const first=calculator.calculate(input);const failure=expect(first).rejects.toThrow('后台工时计算失败');workers[0].onerror?.call(workers[0] as unknown as Worker,{} as ErrorEvent);await failure;
  const next=calculator.calculate(input);finish(1);await next;calculator.cancel();expect(workers[1].terminate).toHaveBeenCalled();
 });
 it('创建Worker失败不会在主线程同步回退', async () => {const calculator=createHoursCalculator(()=>{throw new Error('Worker unavailable');});await expect(calculator.calculate(input)).rejects.toThrow('Worker unavailable');});
});
