import { describe, expect, it } from 'vitest';
import { matrixWindow } from './matrixWindow';
describe('矩阵可见窗口',()=>{
 it('小月视图保持全部成员日期',()=>{expect(matrixWindow(6,31,0,0,600,1000)).toMatchObject({virtual:false,rowStart:0,rowEnd:6,columnStart:0,columnEnd:31,top:0,left:0,bottom:0,right:0});});
 it('大矩阵只保留可见范围及缓冲，滚动后范围前移',()=>{const first=matrixWindow(100,366,0,0,600,1000);const next=matrixWindow(100,366,5000,10000,600,1000);expect(first.rowEnd).toBeLessThan(12);expect(first.columnEnd).toBeLessThan(15);expect(next.rowStart).toBeGreaterThan(0);expect(next.columnStart).toBeGreaterThan(0);expect(next.rowEnd-next.rowStart).toBe(first.rowEnd);});
 it('筛选收缩后滚动偏移不能使窗口为空',()=>{expect(matrixWindow(6,366,100000,100000,600,1000)).toMatchObject({rowStart:5,rowEnd:6,columnStart:365,columnEnd:366,bottom:0,right:0});});
});
