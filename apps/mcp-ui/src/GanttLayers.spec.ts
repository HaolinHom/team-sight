import { describe,it,expect } from 'vitest'
import { mount } from '@vue/test-utils'
import GanttLayers from './GanttLayers.vue'
import type { ScheduleTask,MemberHours } from '@teamsight/core'
const range={start:'2026-11-02',end:'2026-11-03'}
const task:ScheduleTask={id:'101',sourceType:'task',projectId:'1',projectName:'One',projectColor:'#167d7f',title:'Task',assigneeId:'100',assigneeIds:['100'],assigneeName:'A',startDate:range.start,dueDate:range.end,status:'done',tapdUrl:'https://www.tapd.cn/tapd_fe/1/task/detail/101',storyId:'9',effort:'8',hours:{estimate:8,estimateMissing:false,actual:3,actualCoverage:'cumulative',remaining:5}}
const member:MemberHours={member:{staffId:'100',name:'A'},days:[{date:range.start,leaveHours:0,target:8,actual:3,allocated:5,total:8,deficit:0,basis:'forecast',state:'enough',contributions:[{taskKey:'1:task:101',projectId:'1',actual:3,allocated:5,explanation:'source'}],reasons:[]}],pending:[],historicalShortDays:0,forecastShortDays:0}
describe('dual-layer Gantt',()=>{
 it('defaults to interactive tasks over inert translucent hours and exposes task details',async()=>{
  const view=mount(GanttLayers,{props:{tasks:[task],members:[member],range,today:range.start,mode:'tasks'}})
  const layers=view.findAll('[data-layer]');expect(layers.map(layer=>layer.attributes('data-layer'))).toEqual(['hours','tasks'])
  expect(layers[0].attributes('opacity')).toBe('0.18');expect(layers[0].attributes('style')).toContain('pointer-events: none');expect(layers[0].findAll('title')).toHaveLength(0)
  await layers[0].find('g').trigger('click');expect(view.emitted('select')).toBeUndefined()
  await layers[1].find('[role=button]').trigger('click');expect(view.get('[aria-label="任务详情"]').text()).toContain('剩余 5h');expect(view.emitted('select')?.[0]).toEqual([{kind:'task',projectId:'1',id:'101'}]);view.unmount()
 })
 it('hours mode swaps order, disables task hover/focus and opens daily contributions',async()=>{
  const view=mount(GanttLayers,{props:{tasks:[task],members:[member],range,today:range.start,mode:'tasks'}})
  await view.setProps({mode:'hours'});const layers=view.findAll('[data-layer]');expect(layers.map(layer=>layer.attributes('data-layer'))).toEqual(['tasks','hours']);expect(layers[0].find('g').attributes('tabindex')).toBe('-1');expect(layers[0].findAll('title')).toHaveLength(0)
  await layers[1].find('[role=button]').trigger('keydown',{key:'Enter'});expect(view.get('[aria-label="每日工时详情"]').text()).toContain('实际 3h');expect(view.text()).toContain('预计 5h');view.unmount()
 })
 it('members without scheduled tasks still have clickable daily actuals',async()=>{
  const view=mount(GanttLayers,{props:{tasks:[],members:[member],range,today:range.start,mode:'hours'}});expect(view.findAll('[data-layer=hours] [role=button]')).toHaveLength(1)
  await view.get('[data-layer=hours] [role=button]').trigger('click');expect(view.get('[aria-label="每日工时详情"]').text()).toContain('1:task:101');view.unmount()
 })
})
