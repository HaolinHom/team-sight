import { toRaw } from 'vue';
import type { HoursCalculationInput, HoursWorkerRequest, HoursWorkerResult } from './workerProtocol';
export function createHoursCalculator(factory = () => new Worker(new URL('./hours.worker.ts', import.meta.url), { type: 'module' })) {
  let worker: Worker | undefined;
  let snapshot: HoursCalculationInput['snapshot'] | undefined;
  let serial = 0;
  let pending: { reject: (error: Error) => void } | undefined;
  function cancel(): void {
    serial++;
    pending?.reject(new DOMException('计算已取消', 'AbortError'));
    pending = undefined; worker?.terminate(); worker = undefined; snapshot = undefined;
  }
  function calculate(input: HoursCalculationInput): Promise<HoursWorkerResult> {
    if (pending) cancel();
    const id = ++serial;
    return new Promise((resolve, reject) => {
      try {
        worker ??= factory();
        pending = { reject };
        worker.onmessage = (event: MessageEvent<HoursWorkerResult>) => {
          if (event.data.id !== id || serial !== id) return;
          pending = undefined;
          if (event.data.error) { cancel(); reject(new Error(event.data.error)); }
          else resolve(event.data);
        };
        worker.onerror = () => { pending = undefined; cancel(); reject(new Error('后台工时计算失败，请重试')); };
        worker.onmessageerror = () => { pending = undefined; cancel(); reject(new Error('后台工时结果读取失败，请重试')); };
        const request: HoursWorkerRequest = {
          id,
          input: JSON.parse(JSON.stringify({ members: input.members, settings: input.settings, range: input.range, today: input.today, calendar: input.calendar })),
          ...(snapshot !== input.snapshot ? { snapshot: toRaw(input.snapshot) } : {}),
        };
        worker.postMessage(request);
        snapshot = input.snapshot;
      } catch (error) { pending = undefined; cancel(); reject(error); }
    });
  }
  return { calculate, cancel };
}
