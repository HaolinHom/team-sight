import { calculateHours } from './statistics';
import type { HoursSnapshot } from '@/types/hours';
import type { HoursWorkerRequest, HoursWorkerResult } from './workerProtocol';
let snapshot: HoursSnapshot | undefined;
self.onmessage = (event: MessageEvent<HoursWorkerRequest>) => {
  const { id, input } = event.data;
  if (event.data.snapshot) snapshot = event.data.snapshot;
  const start = performance.now();
  let result: HoursWorkerResult;
  try {
    if (!snapshot) throw new Error('计算数据未初始化');
    result = { id, rows: calculateHours({ ...input, snapshot }), calculationMs: performance.now() - start };
  } catch (error) { result = { id, error: String(error), calculationMs: performance.now() - start }; }
  self.postMessage(result);
};
