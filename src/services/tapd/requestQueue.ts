/** 所有窗口请求共享并发上限；取消时移除尚未执行的请求。 */
export function createRequestQueue(limit = 3) {
  let running = 0;
  const queue: Array<() => void> = [];
  function drain(): void { while (running < limit && queue.length) queue.shift()!(); }
  function run<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    return new Promise((resolve, reject) => {
      const abort = () => {
        const index = queue.indexOf(start);
        if (index >= 0) queue.splice(index, 1);
        reject(signal?.reason ?? new DOMException('请求已取消', 'AbortError'));
      };
      const start = () => {
        signal?.removeEventListener('abort', abort);
        if (signal?.aborted) { abort(); return; }
        running++;
        void work().then(resolve, reject).finally(() => { running--; drain(); });
      };
      if (signal?.aborted) { abort(); return; }
      signal?.addEventListener('abort', abort, { once: true });
      queue.push(start); drain();
    });
  }
  return { run };
}
export const requestQueue = createRequestQueue();
