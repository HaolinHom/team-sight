import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import GanttLayers from './GanttLayers.vue'
import type { ScheduleTask, MemberHours } from '@teamsight/core'
const range={start:'2026-11-02',end:'2026-11-03'}
const task:ScheduleTask={id:'101',sourceType:'task',projectId:'1',projectName:'One',projectColor:'#167d7f',title:'Task',assigneeId:'100',assigneeIds:['100'],assigneeName:'A',startDate:range.start,dueDate:range.end,status:'done',tapdUrl:'https://www.tapd.cn/tapd_fe/1/task/detail/101',storyId:'9',effort:'8',hours:{estimate:8,estimateMissing:false,actual:3,actualCoverage:'cumulative',remaining:5}}
const member:MemberHours={member:{staffId:'100',name:'A'},days:[{date:range.start,target:8,actual:3,allocated:5,total:8,deficit:0,basis:'forecast',state:'enough',contributions:[{taskKey:'1:task:101',projectId:'1',actual:3,allocated:5,explanation:'source'}],reasons:[]}],pending:[],historicalShortDays:0,forecastShortDays:0}
let view:VueWrapper
const mountView=(mode:'tasks'|'hours'='tasks')=>view=mount(GanttLayers,{attachTo:document.body,props:{tasks:[task],members:[member],range,today:range.start,mode}})
const detail=()=>document.querySelector<HTMLDialogElement>('dialog')!
const originalShowModal=Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype,'showModal')
beforeEach(()=>{Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(this:HTMLDialogElement){this.setAttribute('open','')}})})
afterEach(()=>{view?.unmount();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();document.body.innerHTML='';if(originalShowModal)Object.defineProperty(HTMLDialogElement.prototype,'showModal',originalShowModal);else Reflect.deleteProperty(HTMLDialogElement.prototype,'showModal')})
describe('dual-layer Gantt',()=>{
 it('keeps only the foreground interactive and opens task details in a modal drawer',async()=>{
  mountView();const layers=view.findAll('[data-layer]')
  expect(layers.map(layer=>layer.attributes('data-layer'))).toEqual(['hours','tasks'])
  expect(layers[0].attributes('opacity')).toBe('0.22');expect(layers[0].attributes('style')).toContain('pointer-events: none')
  await layers[0].find('g').trigger('click');expect(view.emitted('select')).toBeUndefined()
  await layers[1].find('[role=button]').trigger('click');expect(detail().textContent).toContain('剩余 5h');expect(detail().getAttribute('aria-modal')).toBe('true')
  expect(view.find('.gantt-detail').exists()).toBe(false)
  expect(view.emitted('select')?.[0]).toEqual([{kind:'task',projectId:'1',id:'101',sourceType:'task',memberId:'100',displayKind:'planned'}])
 })
 it('hours mode preserves transparent interior, disables task hover/focus and shows source distinctions',async()=>{
  mountView();await view.setProps({mode:'hours'});const layers=view.findAll('[data-layer]')
  expect(layers.map(layer=>layer.attributes('data-layer'))).toEqual(['tasks','hours']);expect(layers[0].find('g').attributes('tabindex')).toBe('-1')
  await layers[0].find('g').trigger('mouseenter');expect(document.querySelector('[role=tooltip]')).toBeNull()
  expect(layers[1].get('.hours-box').attributes('fill')).toBe('transparent')
  await layers[1].find('[role=button]').trigger('keydown',{key:'Enter'});expect(detail().textContent).toContain('实际 3h');expect(detail().textContent).toContain('排期覆盖 · 工时贡献')
 })
 it('members without scheduled tasks retain unknown contribution keys',async()=>{
  mountView('hours');await view.setProps({tasks:[]})
  await view.get('[data-layer=hours] [role=button]').trigger('click');expect(detail().textContent).toContain('任务 #101')
 })
 it('closes on cancel or button, restores focus and preserves both scroll offsets',async()=>{
  mountView();const scroll=view.get('.gantt-scroll').element;scroll.scrollTop=180;scroll.scrollLeft=96
  const bar=view.get('[data-task]');await bar.trigger('click');expect(document.activeElement?.getAttribute('aria-label')).toBe('关闭详情')
  detail().dispatchEvent(new Event('cancel',{cancelable:true}));await flushPromises()
  expect(detail()).toBeNull();expect(document.activeElement).toBe(bar.element)
  expect(scroll.scrollTop).toBe(180);expect(scroll.scrollLeft).toBe(96)
  await bar.trigger('click');(detail().querySelector('button') as HTMLElement).click();await flushPromises();expect(detail()).toBeNull()
 })
 it('traps Tab in the drawer, forwards the TAPD link and closes on backdrop',async()=>{
  mountView();await view.get('[data-task]').trigger('click')
  const close=detail().querySelector('button')!,link=detail().querySelector('a')!
  close.focus();close.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true}));expect(document.activeElement).toBe(link)
  link.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));expect(document.activeElement).toBe(close)
  link.click();expect(view.emitted('open')?.[0]).toEqual([task.tapdUrl])
  detail().dispatchEvent(new MouseEvent('click',{clientX:-1,bubbles:true}));await flushPromises();expect(detail()).toBeNull()
 })
 it('shows delayed boundary-clamped tooltips and hides them on leave, scroll and drawer open',async()=>{
  vi.useFakeTimers();mountView();const bar=view.get('[data-task]')
  vi.spyOn(bar.element,'getBoundingClientRect').mockReturnValue({left:10000,top:10000,bottom:10020} as DOMRect)
  await bar.trigger('mouseenter');await vi.advanceTimersByTimeAsync(199);expect(document.querySelector('[role=tooltip]')).toBeNull()
  await vi.advanceTimersByTimeAsync(1);const tip=document.querySelector<HTMLElement>('[role=tooltip]')!
  expect(tip.textContent).toContain('预估 8h');expect(parseFloat(tip.style.left)).toBeLessThan(window.innerWidth);expect(parseFloat(tip.style.top)).toBeLessThan(window.innerHeight)
  await bar.trigger('mouseleave');expect(document.querySelector('[role=tooltip]')).toBeNull()
  ;(bar.element as SVGElement).focus();window.dispatchEvent(new Event('scroll'));await vi.advanceTimersByTimeAsync(250);expect(document.querySelector('[role=tooltip]')).not.toBeNull()
  window.dispatchEvent(new Event('scroll'));await flushPromises();expect(document.querySelector('[role=tooltip]')).toBeNull()
  await bar.trigger('click');expect(document.querySelector('[role=tooltip]')).toBeNull()
 })
 it('clears a pending tooltip or open drawer when mode or analysis inputs change',async()=>{
  vi.useFakeTimers();mountView();await view.get('[data-task]').trigger('mouseenter');await view.setProps({mode:'hours'});await vi.advanceTimersByTimeAsync(250)
  expect(document.querySelector('[role=tooltip]')).toBeNull()
  await view.get('[data-cell]').trigger('click');expect(detail()).not.toBeNull()
  await view.setProps({tasks:[{...task,title:'New snapshot'}]});expect(detail()).toBeNull()
 })
 it('keeps the drawer inside the visible portion of an iframe scrolled by its host',async()=>{
  const callbacks:IntersectionObserverCallback[]=[]
  vi.stubGlobal('IntersectionObserver',class {constructor(callback:IntersectionObserverCallback){callbacks.push(callback)}observe(){}disconnect(){}})
  mountView();await view.get('[data-task]').trigger('click')
  callbacks.at(-1)!([{intersectionRect:{top:85,left:0,right:760,bottom:650,width:760,height:565}} as IntersectionObserverEntry],{} as IntersectionObserver)
  await flushPromises();expect(detail().style.top).toBe('85px');expect(detail().style.height).toBe('565px')
 })
})

it('virtual bars expose original dates, contributor and actual daily hours with keyboard access',async()=>{
 mountView();await view.setProps({tasks:[{...task,startDate:null,dueDate:null}]})
 const bar=view.get('[data-virtual=true]');expect(bar.get('rect').attributes('stroke-dasharray')).toBe('3 2')
 vi.useFakeTimers();await bar.trigger('mouseenter');await vi.advanceTimersByTimeAsync(250);expect(document.querySelector('[role=tooltip]')?.textContent).toContain('按工时补充')
 await bar.trigger('keydown',{key:'Enter'});expect(detail().textContent).toContain('按工时补充');expect(detail().textContent).toContain('缺开始日');expect(detail().textContent).toContain('实际 3h')
 await view.setProps({mode:'hours'});await view.get('[data-cell]').trigger('click');expect(detail().textContent).toContain('虚拟区间覆盖 · 工时贡献')
})
