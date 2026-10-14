import { describe, expect, it } from 'vitest';
import { createRequestQueue } from './requestQueue';
describe('全局请求队列', () => {
 it('限制并发，并在完成后调度后续请求', async () => {
  const queue=createRequestQueue(2);let active=0,max=0;const finishes:Array<()=>void>=[];
  const work=()=>new Promise<number>(resolve=>{active++;max=Math.max(max,active);finishes.push(()=>{active--;resolve(1);});});
  const pending=Array.from({length:5},()=>queue.run(work));expect(finishes).toHaveLength(2);
  for(let i=0;i<5;i++){finishes[i]();await Promise.resolve();await Promise.resolve();await Promise.resolve();}
  await Promise.all(pending);expect(max).toBe(2);
 });
 it('取消排队请求后不会调用网络，并保持队列可用', async () => {
  const queue=createRequestQueue(1);let finish!:()=>void;const first=queue.run(()=>new Promise<void>(resolve=>{finish=resolve;}));let called=false;const controller=new AbortController();const waiting=queue.run(async()=>{called=true;},controller.signal);const rejection=expect(waiting).rejects.toMatchObject({name:'AbortError'});controller.abort();finish();await first;await rejection;await queue.run(async()=>{});expect(called).toBe(false);
 });
});
