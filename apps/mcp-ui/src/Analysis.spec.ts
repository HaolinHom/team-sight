import {beforeEach,describe,it,expect,vi} from 'vitest'
import {mount,flushPromises} from '@vue/test-utils'
const state=vi.hoisted(()=>({instance:null as any,call:vi.fn(),context:vi.fn()}))
vi.mock('@modelcontextprotocol/ext-apps',()=>({App:class {ontoolresult:any;constructor(){state.instance=this}async connect(){}callServerTool=state.call;updateModelContext=state.context;async openLink(){}}}))
import Analysis from './Analysis.vue'
const range={start:'2026-11-02',end:'2026-11-06'}
const facts={analysisId:'analysis',snapshotId:'snapshot',status:'complete',fetchedAt:'2026-11-02T00:00:00Z',context:{range,analysisDate:range.start,timeZone:'Asia/Shanghai',memberIds:['100'],projectIds:['1'],configRevision:1,calendarVersion:'v1',rulesVersion:'mcp-v2'},sourceContext:{range},unit:'hours',members:[],tasks:[],risks:[],limitations:[],issues:[],nextTaskOffset:null,nextMemberOffset:null,risksTruncated:false,counts:{risks:0,issues:0}}
beforeEach(()=>{state.call.mockReset();state.context.mockReset();state.context.mockResolvedValue({});state.call.mockImplementation(async({name,arguments:args}:any)=>({structuredContent:name==='teamsight_get_config'?{settings:{members:[{staffId:'100',name:'A'}],projects:[{id:'1',name:'One'}]}}:{...facts,context:{...facts.context,range:{start:args.start??range.start,end:args.end??range.end}}},content:[]}))})
describe('analysis host initialization and filters',()=>{
 it('keeps the initial analysis dates without racing a second open request',async()=>{
  const view=mount(Analysis);await flushPromises();await state.instance.ontoolresult({structuredContent:{analysisId:'analysis'}});await flushPromises()
  expect((view.findAll('form input')[0].element as HTMLInputElement).value).toBe(range.start)
  expect(state.call.mock.calls.some(([call])=>call.name==='teamsight_open_analysis')).toBe(false);view.unmount()
 })
 it('sends display dates to the full-result server query and reports them to the host',async()=>{
  const view=mount(Analysis);await flushPromises();await state.instance.ontoolresult({structuredContent:{analysisId:'analysis'}});await flushPromises()
  await view.findAll('nav input')[0].setValue('2026-11-03');await view.findAll('nav input')[1].setValue('2026-11-04');await view.findAll('nav button').at(-1)!.trigger('click');await flushPromises()
  expect(state.call.mock.calls.at(-1)![0]).toMatchObject({name:'teamsight_read_analysis',arguments:{analysisId:'analysis',start:'2026-11-03',end:'2026-11-04'}})
  expect(state.context.mock.calls.at(-1)![0].content[0].text).toContain('2026-11-03');view.unmount()
 })
})
