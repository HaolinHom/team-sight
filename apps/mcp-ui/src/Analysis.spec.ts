import {beforeEach,describe,it,expect,vi} from 'vitest'
import {mount,flushPromises} from '@vue/test-utils'
const state=vi.hoisted(()=>({instance:null as any,call:vi.fn(),context:vi.fn()}))
vi.mock('@modelcontextprotocol/ext-apps',()=>({applyDocumentTheme:vi.fn(),applyHostStyleVariables:vi.fn(),App:class {ontoolresult:any;ontoolinput:any;constructor(){state.instance=this}async connect(){}getHostContext(){return {theme:'light'}}callServerTool=state.call;updateModelContext=state.context;async openLink(){}}}))
import Analysis from './Analysis.vue'
const range={start:'2026-11-02',end:'2026-11-06'}
const facts={analysisId:'analysis',snapshotId:'snapshot',status:'complete',fetchedAt:'2026-11-02T00:00:00Z',context:{range,analysisDate:range.start,timeZone:'Asia/Shanghai',memberIds:['100'],projectIds:['1'],configRevision:1,calendarVersion:'v1',rulesVersion:'mcp-v2'},members:[],tasks:[],limitations:[],issues:[],nextTaskOffset:null,nextMemberOffset:null}
const response=(value:unknown)=>({structuredContent:value,content:[]})
beforeEach(()=>{state.call.mockReset();state.context.mockReset();state.context.mockResolvedValue({});state.call.mockResolvedValue(response(facts))})
describe('focused analysis card',()=>{
 it('only exposes mode switching and honors the conversation range and initial mode',async()=>{
  const view=mount(Analysis);await flushPromises();await state.instance.ontoolresult(response({analysisId:'analysis',mode:'hours',viewFilters:{start:'2026-11-03',end:'2026-11-04',projectIds:['1']}}));await flushPromises()
  expect(view.findAll('form,input,select,nav')).toHaveLength(0)
  expect(view.findAll('button').map(button=>button.text())).toEqual(['任务优先','工时优先'])
  expect(view.get('[aria-label="甘特图模式"] button[aria-pressed=true]').text()).toBe('工时优先')
  expect(state.call).toHaveBeenCalledWith({name:'teamsight_read_analysis',arguments:{analysisId:'analysis',start:'2026-11-03',end:'2026-11-04',projectIds:['1']}})
  expect(state.context.mock.calls.at(-1)![0].content[0].text).toContain('snapshot');view.unmount()
 })
 it('loads all member and task pages with the same scope before displaying facts',async()=>{
  state.call.mockImplementation(async({arguments:args}:any)=>response({...facts,nextMemberOffset:args.memberOffset?null:20,nextTaskOffset:args.taskOffset?null:200}))
  const view=mount(Analysis);await flushPromises();await state.instance.ontoolresult(response({analysisId:'analysis',viewFilters:{memberIds:['100'],start:range.start,end:range.end}}));await flushPromises()
  expect(state.call).toHaveBeenCalledTimes(3)
  for(const [request] of state.call.mock.calls)expect(request.arguments).toMatchObject({memberIds:['100'],start:range.start,end:range.end})
  expect(view.attributes('aria-busy')).toBe('false');view.unmount()
 })
 it('ignores late pages from a previous result',async()=>{
  let finish:any;state.call.mockImplementation(({arguments:args}:any)=>args.analysisId==='old'?new Promise(resolve=>{finish=resolve}):Promise.resolve(response({...facts,analysisId:'new'})))
  const view=mount(Analysis);await flushPromises();state.instance.ontoolresult(response({analysisId:'old'}));await flushPromises();state.instance.ontoolresult(response({analysisId:'new'}));await flushPromises();finish(response({...facts,analysisId:'old'}));await flushPromises()
  expect(state.context.mock.calls.at(-1)![0].content[0].text).toContain('new');view.unmount()
 })
 it('follows an async job and hides stale data on a later error',async()=>{
  state.call.mockImplementation(async({name}:any)=>response(name==='teamsight_get_job'?{status:'completed',analysisId:'analysis'}:facts))
  const view=mount(Analysis);await flushPromises();state.instance.ontoolresult(response({jobId:'job',status:'running'}));await flushPromises();expect(view.find('.gantt-scroll').exists()).toBe(true)
  state.instance.ontoolresult({...response({code:'CALCULATION_EXPIRED'}),isError:true});await flushPromises();expect(view.find('.gantt-scroll').exists()).toBe(false);expect(view.find('[role=alert]').exists()).toBe(true);view.unmount()
 })
})
