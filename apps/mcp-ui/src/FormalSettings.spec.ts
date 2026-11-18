import {beforeEach,describe,it,expect,vi} from 'vitest'
import {mount,flushPromises} from '@vue/test-utils'
const state=vi.hoisted(()=>({instance:null as any,call:vi.fn(),context:vi.fn(),send:vi.fn()}))
vi.mock('@modelcontextprotocol/ext-apps',()=>({applyDocumentTheme:vi.fn(),applyHostStyleVariables:vi.fn(),App:class {ontoolresult:any;ontoolinput:any;constructor(){state.instance=this}async connect(){}getHostContext(){return {theme:'light'}}callServerTool=state.call;updateModelContext=state.context;sendMessage=state.send}}))
import FormalSettings from './FormalSettings.vue'
import {categories,settingsTarget} from './settings-model'
import {createDefaultSettings} from '@teamsight/core'
const settings={schemaVersion:6,teamName:'Team',timeZone:'Asia/Shanghai',projects:[{id:'1',name:'One',enabled:true,color:'#EB732D',alias:'Alias'}],members:[],groups:[{id:'default',name:'默认组',memberIds:[]}],defaultGroupId:'default',currentUser:{staffId:'100',name:'Me'},hours:{dailyRequiredHours:8,completedStates:[]},chinaCalendar:{enabled:true,years:{}},tapd:{baseUrl:'https://api.tapd.cn',defaultTypes:['task'],writeAccess:{operations:[],fields:[]}},updatedAt:''}
const snapshot={settings,revision:4,credentialPresent:true}
const response=(value:unknown)=>({structuredContent:JSON.parse(JSON.stringify(value)),content:[]})
beforeEach(()=>{state.call.mockReset();state.context.mockReset();state.send.mockReset();state.context.mockResolvedValue({});state.send.mockResolvedValue({});state.call.mockResolvedValue(response(snapshot))})
async function open(target:string){const view=mount(FormalSettings);state.instance.ontoolinput({arguments:{target}});await flushPromises();return view}
describe('directed settings',()=>{
 it('renders only the requested projects form',async()=>{const view=await open('projects');expect(view.text()).toContain('项目配置');expect(view.text()).not.toContain('每日规定工时');expect(view.find('input[type=password]').exists()).toBe(false);expect(view.find('.categories').exists()).toBe(false);expect(view.text()).not.toContain('返回分类');view.unmount()})
 it('saves a nested partial patch without unrelated values',async()=>{const view=await open('hours');await view.get('input[type=number]').setValue('7');await view.get('.save-bar .primary').trigger('click');await flushPromises();expect(state.call).toHaveBeenLastCalledWith({name:'teamsight_save_settings',arguments:{expectedRevision:4,patch:{hours:{dailyRequiredHours:7}}}});view.unmount()})
 it('preserves the draft on a revision conflict and requires a deliberate discard before reloading',async()=>{const view=await open('hours');state.call.mockResolvedValueOnce({...response({code:'REVISION_CONFLICT'}),isError:true});await view.get('input[type=number]').setValue('6');await view.get('.save-bar .primary').trigger('click');await flushPromises();expect((view.get('input[type=number]').element as HTMLInputElement).value).toBe('6');expect(view.text()).toContain('编辑已保留');await view.findAll('button').find(b=>b.text()==='重新读取')!.trigger('click');expect(view.find('[aria-label="未保存更改"]').exists()).toBe(true);view.unmount()})
 it('guards immediate synchronization when project preferences have a draft',async()=>{const view=await open('projects');await view.get('input[type=checkbox]').setValue(false);await view.findAll('button').find(b=>b.text()==='同步项目')!.trigger('click');expect(state.call).toHaveBeenCalledTimes(1);expect(view.find('[aria-label="未保存更改"]').exists()).toBe(true);await view.findAll('button').find(b=>b.text()==='放弃后继续')!.trigger('click');await flushPromises();expect(state.call).toHaveBeenLastCalledWith({name:'teamsight_sync_projects',arguments:{}});view.unmount()})
 it('does not resume the original request after a partial initialization',async()=>{const view=await open('connection');state.instance.ontoolinput({arguments:{target:'connection',continueRead:true}});state.call.mockResolvedValueOnce(response({...snapshot,bootstrap:{status:'partial'}}));await view.get('input[type=password]').setValue('fixture');await view.get('.save-bar .primary').trigger('click');await flushPromises();expect(state.send).not.toHaveBeenCalled();expect(view.text()).toContain('初始化尚未完成');view.unmount()})
 it('steps daily hours within the supported range and saves only that field',async()=>{const view=await open('hours');await view.get('input[type=number]').setValue('24');expect(view.get('[aria-label="增加每日规定工时"]').attributes('disabled')).toBeDefined();await view.get('[aria-label="减少每日规定工时"]').trigger('click');expect((view.get('input[type=number]').element as HTMLInputElement).value).toBe('23.5');await view.get('.save-bar .primary').trigger('click');await flushPromises();expect(state.call).toHaveBeenLastCalledWith({name:'teamsight_save_settings',arguments:{expectedRevision:4,patch:{hours:{dailyRequiredHours:23.5}}}});view.unmount()})
 it('requires confirmation before deleting and allows restoring the saved draft',async()=>{const view=await open('projects');await view.get('.edit-button').trigger('click');await view.get('.remove-trigger').trigger('click');expect(view.findAll('.directory-item')).toHaveLength(1);await view.get('.confirm-remove').trigger('click');expect(view.findAll('.directory-item')).toHaveLength(0);expect(state.call).toHaveBeenCalledTimes(1);await view.get('.save-actions .secondary').trigger('click');expect(view.findAll('.directory-item')).toHaveLength(1);view.unmount()})
 it('opens new groups for editing and retains the unique default group',async()=>{const view=await open('groups');await view.get('.add-row').trigger('click');await flushPromises();const panels=view.findAll('.group-panel');expect(panels).toHaveLength(2);expect(panels[1].attributes('open')).toBeDefined();expect((view.get('#default-group').element as HTMLSelectElement).value).toBe('default');view.unmount()})
 it('clears success feedback when a new draft is edited',async()=>{const view=await open('hours');await view.get('input[type=number]').setValue('7');await view.get('.save-bar .primary').trigger('click');await flushPromises();expect(view.text()).toContain('已保存更改。');await view.get('input[type=number]').setValue('6');expect(view.text()).not.toContain('已保存更改。');view.unmount()})

})

describe('simplified connection settings',()=>{
 it('shows fresh defaults checked and persists an opt-out without reselecting on reopen',async()=>{
  const saved={settings:createDefaultSettings(),revision:0,credentialPresent:false}
  state.call.mockResolvedValue(response(saved))
  let view=await open('connection')
  const checkboxes=view.findAll('input[type=checkbox]')
  expect(checkboxes).toHaveLength(13)
  expect(checkboxes.every(input=>(input.element as HTMLInputElement).checked)).toBe(true)
  await view.get('input[type=password]').setValue('DEFAULTS_FIXTURE')
  await view.get('input[value=comment]').setValue(false)
  saved.settings.tapd.writeAccess!.operations=['create','update'];saved.revision=1;saved.credentialPresent=true
  state.call.mockResolvedValue(response(saved))
  await view.get('.save-actions .primary').trigger('click');await flushPromises()
  expect(state.call).toHaveBeenLastCalledWith({name:'teamsight_save_settings',arguments:{expectedRevision:0,patch:{tapd:{writeAccess:{operations:['create','update']}}},tapdToken:'DEFAULTS_FIXTURE'}})
  view.unmount();view=await open('connection')
  expect((view.get('input[value=comment]').element as HTMLInputElement).checked).toBe(false)
  view.unmount();view=await open('calendar')
  expect((view.get('input[type=checkbox]').element as HTMLInputElement).checked).toBe(true)
  await view.get('input[type=checkbox]').setValue(false)
  saved.settings.chinaCalendar.enabled=false;saved.revision=2
  state.call.mockResolvedValue(response(saved))
  await view.get('.save-actions .primary').trigger('click');await flushPromises()
  expect(state.call).toHaveBeenLastCalledWith({name:'teamsight_save_settings',arguments:{expectedRevision:1,patch:{chinaCalendar:{enabled:false}}}})
  view.unmount();view=await open('calendar')
  expect((view.get('input[type=checkbox]').element as HTMLInputElement).checked).toBe(false)
  view.unmount()
 })
 it('keeps legacy missing permissions unselected',async()=>{
  const legacy=JSON.parse(JSON.stringify(snapshot));delete legacy.settings.tapd.writeAccess
  state.call.mockResolvedValue(response(legacy))
  const view=await open('connection')
  expect((view.get('input[value=create]').element as HTMLInputElement).checked).toBe(false)
  expect((view.get('input[value=comment]').element as HTMLInputElement).checked).toBe(false)
  view.unmount()
 })
 it('saves the separate comment permission without enabling field edits',async()=>{
  const view=await open('connection')
  expect((view.get('input[value=comment]').element as HTMLInputElement).checked).toBe(false)
  await view.get('input[value=comment]').setValue(true)
  await view.get('.save-actions .primary').trigger('click');await flushPromises()
  expect(state.call).toHaveBeenLastCalledWith({name:'teamsight_save_settings',arguments:{expectedRevision:4,patch:{tapd:{writeAccess:{operations:['comment']}}}}})
  view.unmount()
 })
 it('offers seven categories and rejects retired targets',async()=>{
  expect(categories.map(item=>item.id)).toEqual(['connection','projects','members','groups','hours','calendar','completed'])
  for(const old of ['write','general','leave','import'])expect(()=>settingsTarget(old)).toThrow('INVALID_SETTINGS_TARGET')
  const view=await open('overview');expect(view.findAll('.category-row')).toHaveLength(7)
  for(const removed of ['请假配置','旧配置导入','TAPD 写入范围','其他设置'])expect(view.text()).not.toContain(removed)
  view.unmount()
 })
 it('saves moved preferences together, retains custom fields, and reads them back without unrelated changes',async()=>{
  const saved=JSON.parse(JSON.stringify(snapshot));saved.settings.tapd.writeAccess.fields=['name','custom_field_one']
  state.call.mockResolvedValue(response(saved))
  const view=await open('connection')
  expect(view.text()).toContain('账号连接');expect(view.text()).toContain('查询内容');expect(view.text()).toContain('写入权限')
  for(const removed of ['允许写入的项目','项目 ID 列表','默认查询项目','团队名称','请假配置'])expect(view.text()).not.toContain(removed)
  expect(view.find('.categories').exists()).toBe(false)
  await view.get('input[value=bug]').setValue(true)
  await view.get('input[value=create]').setValue(true)
  await view.get('input[value=effort]').setValue(true)
  saved.settings.tapd.defaultTypes=['task','bug'];saved.settings.tapd.writeAccess.operations=['create'];saved.settings.tapd.writeAccess.fields=['name','custom_field_one','effort'];saved.revision=5
  state.call.mockResolvedValue(response(saved))
  await view.get('.save-actions .primary').trigger('click');await flushPromises()
  expect(state.call).toHaveBeenLastCalledWith({name:'teamsight_save_settings',arguments:{expectedRevision:4,patch:{tapd:{defaultTypes:['task','bug'],writeAccess:{operations:['create'],fields:['name','custom_field_one','effort']}}}}})
  view.unmount()
  const reopened=await open('connection');expect((reopened.get('input[value=bug]').element as HTMLInputElement).checked).toBe(true)
  expect((reopened.get('.stack-field input').element as HTMLInputElement).value).toContain('custom_field_one')
  reopened.unmount()
 })
})
