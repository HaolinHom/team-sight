import { randomUUID } from 'node:crypto'
import { businessDate, normalizeDateKey, parseAssignees, resolveMemberScope, hoursTaskKey, parseHours, isHoursCompleted, planSchedule, checkRisks,
  type TeamSightSettings, type MemberEntry, type RawRow, type TeamAnalysis, type PlanningTask, type PlanningDependency, type PlanningInput, type PlanningResult, type CapacityDay, type ScheduleTask } from '@teamsight/core'
import { BusinessError, type TeamSightBusiness, type AnalysisInput } from './business.js'
import { digest, fieldHashes, type OperationReceipt } from './business-storage.js'
import type { TeamSightStore } from './storage.js'

export type Reference = string | { workspaceId: string; entityType: 'story' | 'task' | 'bug'; id: string }
export function parseReference(reference: Reference) {
  if(typeof reference!=='string') return reference
  let url: URL
  try { url=new URL(reference) } catch { throw new BusinessError('INVALID_TAPD_LINK') }
  if(url.protocol!=='https:' || !['www.tapd.cn','tapd.cn'].includes(url.hostname) || url.username || url.password || url.port) throw new BusinessError('INVALID_TAPD_LINK')
  const match=/^\/tapd_fe\/(\d+)\/(story|task|bug)\/detail\/(\d+)(?:\/|$)/.exec(url.pathname)
  const legacy=/^\/(\d+)\/(?:prong\/)?(stories|tasks|bugs)\/view\/(\d+)(?:\/|$)/.exec(url.pathname)
  if(!match && !legacy) throw new BusinessError('UNSUPPORTED_TAPD_LINK')
  return {workspaceId:(match??legacy)![1],entityType:(match?.[2]??({stories:'story',tasks:'task',bugs:'bug'} as const)[legacy![2] as 'stories']) as 'story'|'task'|'bug',id:(match??legacy)![3]}
}
const urlFor=(workspace:string,type:string,id:string)=>'https://www.tapd.cn/tapd_fe/'+workspace+'/'+type+'/detail/'+id
const identity=(row:RawRow):MemberEntry=>({staffId:parseAssignees(row.user)[0]?.id??'user:'+String(row.user),name:String(row.name??String(row.user).replace(/_\d+$/,'')),account:String(row.user),enabled:true})
const shift=(date:string,amount:number)=>{const value=new Date(date+'T00:00:00Z');value.setUTCDate(value.getUTCDate()+amount);return value.toISOString().slice(0,10)}
export interface ScheduleRequest {
  tasks: Array<Omit<PlanningTask,'memberIds'> & {memberIds?: string[]}>
  start?: string; end?: string; analysisDate?: string; direction?: 'forward'|'backward'
  anchor?: {date:string; allowSameDay?:boolean}; dependencies?:PlanningDependency[]; milestones?:Array<{ref:string;date:string}>
  maxStates?:number; allowSameDay?:boolean; memberIds?:string[]; groupIds?:string[]; testerMemberIds?:string[]
}
export interface Calculation {
  calculationId:string; analysisId:string; sourceFingerprint:string; createdAt:number; input:ScheduleRequest
  result:PlanningResult; analysis:TeamAnalysis; releasedTaskKeys:string[]; mode:'ordinary'|'urgent'; affectedTaskKeys?:string[]
}
export function createScenarios(business:TeamSightBusiness,store:TeamSightStore) {
  const calculations=new Map<string,Calculation>()
  const batchLocks=new Set<string>()
  const settings=()=>store.readSettings()
  const api=()=>business.client(settings())
  const getConfig=()=>settings()
  function updateConfig(expectedRevision:number,patch:Partial<TeamSightSettings>) {
    const next={...settings().settings,...patch}
    if(patch.groups && (new Set(patch.groups.map(group=>group.id)).size!==patch.groups.length || !patch.groups.some(group=>group.id===next.defaultGroupId))) throw new BusinessError('INVALID_DEFAULT_GROUP')
    if(patch.defaultGroupId && !next.groups?.some(group=>group.id===patch.defaultGroupId)) throw new BusinessError('INVALID_DEFAULT_GROUP')
    if(next.groups?.some(group=>group.memberIds.some(id=>!next.members.some(member=>member.staffId===id)))) throw new BusinessError('GROUP_MEMBER_NOT_FOUND')
    if(new Set(next.members.map(member=>member.staffId)).size!==next.members.length || new Set(next.projects.map(project=>project.id)).size!==next.projects.length) throw new BusinessError('DUPLICATE_IDENTITY')
    const result=store.saveSettings({expectedRevision,patch});business.files.invalidateCache();return result
  }
  async function syncProjects() {
    const before=settings(),client=api()
    const [visible,userResult]=await Promise.all([client.listProjects(),client.currentUser().then(user=>({user})).catch(()=>({user:undefined}))])
    const projects:TeamSightSettings['projects']=visible.map((project,index)=>{const old=before.settings.projects.find(old=>old.id===project.id);return {...project,...old,name:project.name,enabled:old?.enabled??true,available:true,order:old?.order??index}})
    for(const project of before.settings.projects) if(!projects.some(row=>row.id===project.id)) projects.push({...project,available:false})
    let currentUser=before.settings.currentUser
    const candidates=new Map<string,MemberEntry>()
    if(userResult.user) for(const project of visible) {
      const directory=await client.members(project.id)
      for(const row of directory.rows) if([userResult.user.nick,userResult.user.name].some(value=>value && String(value)===String(row.user))) candidates.set(String(row.user),identity(row))
      if(candidates.size===1 && directory.complete) break
    }
    if(candidates.size===1) currentUser=[...candidates.values()][0]
    if(settings().revision!==before.revision) throw new BusinessError('REVISION_CONFLICT',{current:settings()})
    projects.sort((a,b)=>(a.order??0)-(b.order??0))
    const saved=store.saveSettings({expectedRevision:before.revision,patch:{projects,currentUser,members:currentUser&&!before.settings.members.some(member=>member.staffId===currentUser!.staffId)?[...before.settings.members,currentUser]:before.settings.members,tapd:{...before.settings.tapd,workspaceIds:visible.map(project=>project.id)}}})
    business.files.invalidateCache()
    return {...saved,bootstrap:{projects:'complete',currentUser:currentUser?'complete':'unresolved',next:currentUser?'Continue the original read request.':'Current user could not be verified; resolve the account before using self scope.'}}
  }
  async function resolveMembers(input:{query:string;workspaceIds?:string[];selectedAccount?:string}) {
    const current=settings()
    if(['我','me','self'].includes(input.query.toLowerCase())) {
      if(!current.settings.currentUser) await syncProjects()
      const user=settings().settings.currentUser
      if(!user) throw new BusinessError('CURRENT_USER_UNRESOLVED')
      return {status:'resolved',member:user,savedIdentityOnly:true,suggestGrouping:!settings().settings.groups?.some(group=>group.memberIds.includes(user.staffId))}
    }
    const matches=(member:MemberEntry,exact:boolean)=>[member.staffId,member.account,member.name].some(value=>value&&(exact?value===input.query:value.toLowerCase().includes(input.query.toLowerCase())))
    const localExact=current.settings.members.filter(member=>matches(member,true))
    const local=localExact.length?localExact:current.settings.members.filter(member=>matches(member,false))
    if(localExact.length && local.every(member=>member.account) && !input.selectedAccount) return local.length===1?{status:'resolved',member:local[0],savedIdentityOnly:true,suggestGrouping:!current.settings.groups?.some(group=>group.memberIds.includes(local[0].staffId))}:{status:'ambiguous',candidates:local}
    const projectIds=input.workspaceIds??current.settings.projects.filter(project=>project.enabled&&project.available!==false).map(project=>project.id)
    if(!projectIds.length) throw new BusinessError('CONFIG_REQUIRED',{next:'teamsight_open_settings'})
    const found=new Map<string,MemberEntry>(),issues:string[]=[]
    for(const projectId of projectIds) {
      business.assertProject(current.settings,projectId)
      const directory=await api().members(projectId)
      if(!directory.complete) issues.push(projectId+':'+directory.error)
      for(const row of directory.rows) {const member=identity(row);if(matches(member,false)) found.set(member.account!,member)}
    }
    let candidates=[...found.values()],exact=candidates.filter(member=>matches(member,true))
    if(exact.length) candidates=exact
    const selected=input.selectedAccount?candidates.find(member=>member.account===input.selectedAccount):candidates.length===1?candidates[0]:undefined
    if(issues.length) return {status:'partial',candidates,issues}
    if(!selected) return {status:candidates.length?'ambiguous':'not_found',candidates}
    const latest=settings(),existing=latest.settings.members.find(member=>member.staffId===selected.staffId)
    if(existing?.account && existing.account!==selected.account) return {status:'ambiguous',candidates:[existing,selected]}
    const members=latest.settings.members.filter(member=>member.staffId!==selected.staffId)
    members.push({...selected,...existing,account:selected.account})
    store.saveSettings({expectedRevision:latest.revision,patch:{members}})
    return {status:'resolved',member:selected,savedIdentityOnly:true,suggestGrouping:!latest.settings.groups?.some(group=>group.memberIds.includes(selected.staffId))}
  }
  async function member(value?:string):Promise<MemberEntry> {
    const resolved=await resolveMembers({query:value??'我'})
    if(resolved.status!=='resolved' || !resolved.member) throw new BusinessError('IDENTITY_AMBIGUOUS_OR_UNKNOWN',{resolution:resolved})
    return resolved.member
  }
  async function requirementContext(reference:Reference,options:{testerMemberIds?:string[];includeHistory?:boolean;includeMaterials?:boolean}={}) {
    const ref=parseReference(reference),current=settings()
    business.assertProject(current.settings,ref.workspaceId)
    const source=await business.readItem(ref)
    const storyId=ref.entityType==='story'?ref.id:String((source.item as RawRow).story_id??'')
    if(!storyId || storyId==='0') return {status:'partial',reference:ref,item:source.item,sourceDigest:source.digest,issues:['对象没有关联需求'],tasks:[],fetchedAt:new Date().toISOString()}
    const story=ref.entityType==='story'?source:await business.readItem({workspaceId:ref.workspaceId,entityType:'story',id:storyId})
    const children=await api().pages('/tasks',{workspace_id:ref.workspaceId,story_id:storyId},'Task')
    const issues:string[]=[],rows=children.rows.filter(row=>String(row.story_id)===storyId)
    if(!children.complete) issues.push(children.error??'TASKS_INCOMPLETE')
    if(rows.length!==children.rows.length) issues.push('关联需求过滤返回了其他需求任务')
    const testers=new Set([...(options.testerMemberIds??[]),...(current.settings.groups??[]).filter(group=>group.testing).flatMap(group=>group.memberIds)])
    const tasks:Array<RawRow & {isTesting:boolean;tapdUrl:string}>=rows.map(row=>({...row,isTesting:String(row.name??'').includes('测试') || parseAssignees(row.owner).some(owner=>testers.has(owner.id??'user:'+owner.name)),tapdUrl:urlFor(ref.workspaceId,'task',String(row.id))}))
    const testing=tasks.filter(task=>task.isTesting && normalizeDateKey(task.begin) && normalizeDateKey(task.due) && normalizeDateKey(task.begin)!<=normalizeDateKey(task.due)!).sort((a,b)=>String(a.begin).localeCompare(String(b.begin)))
    const description=String((story.item as RawRow).description??'')
    const inlineImages=[...description.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)].map(match=>({url:match[1],source:'description'}))
    const history=options.includeHistory?await api().storyHistory(ref.workspaceId,storyId):undefined
    const attachments=options.includeMaterials===false?undefined:await api().attachments(ref.workspaceId,storyId)
    if(attachments&&!attachments.complete) issues.push('附件不可完整获取：'+attachments.error)
    if(attachments?.rows.some(row=>String(row.entry_id)!==storyId)) issues.push('附件关联筛选返回了其他对象')
    if(history&&!history.complete) issues.push('需求历史不可完整获取：'+history.error)
    return {status:issues.length?'partial':'complete',reference:ref,story:{...story.item,tapdUrl:urlFor(ref.workspaceId,'story',storyId)},sourceDigest:story.digest,tasks,earliestTesting:testing[0]??null,
      materials:{description,inlineImages,attachments:{status:!attachments?'not_requested':attachments.complete?'complete':'partial',rows:attachments?.rows.filter(row=>String(row.entry_id)===storyId)??[],httpStatus:attachments?.httpStatus,error:attachments?.error,references:[...description.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["']/gi)].map(match=>match[1]),reason:'附件元数据来自 attachments；短期下载链接可通过 attachments.download_link 获取。'}},
      history:history?{status:history.complete?'complete':'partial',rows:history.rows}:undefined,query:{workspaceId:ref.workspaceId,storyId,reference:ref},businessDate:businessDate(current.settings.timeZone),issues,fetchedAt:new Date(children.fetchedAt).toISOString()}
  }
  async function workContext(input:AnalysisInput & {includeHistory?:boolean}) {
    if(input.scope==='self'&&!settings().settings.currentUser) await syncProjects()
    const analysis=await business.analyze(input),events:Array<Record<string,unknown>>=[],historyIssues:string[]=[]
    const stories=[...new Set(analysis.snapshot.tasks.filter(task=>task.storyId).map(task=>task.projectId+':'+task.storyId))]
    if(input.includeHistory!==false) for(const key of stories) {
      const [workspace,id]=key.split(':'),history=await api().storyHistory(workspace,id)
      if(!history.complete) historyIssues.push(key+':'+history.error)
      for(const row of history.rows) {const date=normalizeDateKey(row.created??row.change_time);if(date&&date>=input.start&&date<=input.end) events.push({kind:'story_change',workspaceId:workspace,entityId:id,date,raw:row,source:'story_changes'})}
    }
    if(input.includeHistory!==false) for(const workspace of analysis.context.projectIds) {
      const ids=analysis.snapshot.tasks.filter(task=>task.projectId===workspace&&task.sourceType==='task').map(task=>task.id)
      for(let offset=0;offset<ids.length;offset+=50){
        const batch=ids.slice(offset,offset+50),history=await api().taskHistory(workspace,batch)
        if(!history.complete) historyIssues.push(workspace+':task_history:'+history.error)
        for(const row of history.rows){
          if(!batch.includes(String(row.task_id))){historyIssues.push(workspace+':task_history_filter_mismatch');continue}
          const date=normalizeDateKey(row.created);if(date&&date>=input.start&&date<=input.end) events.push({kind:'task_change',workspaceId:workspace,entityId:String(row.task_id),date,raw:row,source:'task_changes'})
        }
      }
    }
    for(const task of analysis.snapshot.tasks) for(const [field,kind] of [['createdAt','created'],['completedAt','completed']] as const) {
      const date=normalizeDateKey(task[field]);if(date&&date>=input.start&&date<=input.end) events.push({kind,date,taskKey:hoursTaskKey(task),source:'current_object_timestamp'})
    }
    return {analysisId:analysis.analysisId,context:analysis.context,fetchedAt:analysis.fetchedAt,status:analysis.status==='complete'&&historyIssues.length?'partial':analysis.status,currentItems:analysis.snapshot.tasks,
      actualRecords:analysis.snapshot.records.filter(record=>analysis.context.memberIds.includes(record.staffId)&&record.spentDate>=input.start&&record.spentDate<=input.end&&record.spentDate<=analysis.context.analysisDate),periodEvents:events,
      activityCoverage:{storyHistory:input.includeHistory===false?'not_requested':'attempted',taskHistory:input.includeHistory===false?'not_requested':'attempted',note:'当前状态不代表期间状态变更；仅返回有来源的期间事件。'},issues:[...analysis.snapshot.issues,...historyIssues],members:analysis.members}
  }

  function capacities(analysis:TeamAnalysis,released:string[]):Record<string,CapacityDay[]> {
    return Object.fromEntries(analysis.members.map(member=>[member.member.staffId,member.days.map(day=>{
      const occupied=day.contributions.filter(row=>!released.includes(row.taskKey)).reduce((sum,row)=>sum+row.allocated,0)
      return {date:day.date,target:day.target,actual:day.actual,occupied,available:Math.max(day.target-day.actual-occupied,0),unknown:analysis.status!=='complete'||day.reasons.length>0}
    })]))
  }
  const fingerprint=(analysis:TeamAnalysis)=>digest({revision:analysis.context.configRevision,calendar:analysis.context.calendarVersion,range:analysis.context.range,members:analysis.context.memberIds,tasks:analysis.snapshot.tasks,records:analysis.snapshot.records,issues:analysis.snapshot.issues,status:analysis.status})
  function remember(value:Omit<Calculation,'calculationId'|'createdAt'>) {
    for(const [id,row] of calculations) if(Date.now()-row.createdAt>30*60_000) calculations.delete(id)
    while(calculations.size>=50) calculations.delete(calculations.keys().next().value!)
    const calculationId=randomUUID();calculations.set(calculationId,{...value,calculationId,createdAt:Date.now()});return calculationId
  }
  function getCalculation(id:string) {
    const value=calculations.get(id)
    if(!value||Date.now()-value.createdAt>30*60_000) {calculations.delete(id);throw new BusinessError('CALCULATION_EXPIRED',{next:'Re-read TAPD and calculate again.'})}
    return value
  }
  async function prepare(input:ScheduleRequest,team=false) {
    const current=settings(),today=input.analysisDate??businessDate(current.settings.timeZone)
    const anchorEnd=input.anchor?shift(input.anchor.date,input.anchor.allowSameDay?0:-1):undefined
    const end=input.end??anchorEnd??shift(today,89),start=input.start??(input.direction==='backward'?([today,shift(end,-89)].sort().at(-1)!):today)
    if(start<today || start>end || input.end&&anchorEnd&&input.end>anchorEnd) throw new BusinessError('INVALID_PLANNING_WINDOW')
    let teamMembers:MemberEntry[]=[]
    if(team||input.memberIds?.length||input.groupIds?.length) {try {teamMembers=resolveMemberScope(settings().settings,input)}catch(error){throw new BusinessError((error as Error).message)}}
    const tasks:PlanningTask[]=[]
    for(const task of input.tasks) {
      const eligible=task.memberIds?.length?await Promise.all(task.memberIds.map(id=>member(id))):teamMembers.length?teamMembers:[await member()]
      tasks.push({...task,memberIds:[...new Set(eligible.map(member=>member.staffId))],latest:[task.latest,end,anchorEnd].filter((value):value is string=>!!value).sort()[0]})
    }
    const ids=[...new Set([...teamMembers.map(member=>member.staffId),...tasks.flatMap(task=>task.memberIds)])]
    const analysis=await business.analyze({start,end,analysisDate:today,memberIds:ids,refresh:true})
    const released=tasks.flatMap(task=>task.originalTaskKey?[task.originalTaskKey]:[])
    if(released.some(key=>!analysis.snapshot.tasks.some(task=>hoursTaskKey(task)===key))) throw new BusinessError('REPLAN_TARGET_NOT_IN_SCOPE')
    const totals=new Map<string,number>()
    for(const record of analysis.snapshot.records) if(record.spentDate<=today) {const key=[record.projectId,record.entityType,record.entityId].join(':');totals.set(key,(totals.get(key)??0)+record.hours)}
    for(const task of tasks) if(task.originalTaskKey) {
      const original=analysis.snapshot.tasks.find(row=>hoursTaskKey(row)===task.originalTaskKey)!
      task.hours=isHoursCompleted(original,settings().settings.hours)?0:Math.max((parseHours(original.effort)??0)-(totals.get(task.originalTaskKey)??0),0)
    }
    return {analysis,tasks,released,totals,engine:{range:{start,end},tasks,capacities:capacities(analysis,released),dependencies:input.dependencies,milestones:input.milestones,direction:input.direction,maxStates:input.maxStates} satisfies PlanningInput}
  }
  async function plan(input:ScheduleRequest) {
    const prepared=await prepare(input),result=planSchedule(prepared.engine),sourceFingerprint=fingerprint(prepared.analysis)
    const calculationId=remember({analysis:prepared.analysis,analysisId:prepared.analysis.analysisId,input,result,sourceFingerprint,releasedTaskKeys:prepared.released,mode:'ordinary'})
    return {...result,calculationId,analysisId:prepared.analysis.analysisId,sourceFingerprint,context:prepared.analysis.context,releasedTaskKeys:prepared.released}
  }
  async function urgent(input:ScheduleRequest & {mode:'direct'|'reallocate'|'multi';deadline:string;allowReallocation?:boolean}) {
    const reallocate=input.mode==='reallocate'||input.mode==='multi'&&input.allowReallocation!==false
    const today=input.analysisDate??businessDate(settings().settings.timeZone)
    const horizon=reallocate?(input.end??[input.deadline,shift(today,89)].sort().at(-1)!):input.deadline
    const urgentTasks=input.tasks.map(task=>({...task,latest:[task.latest,input.deadline,input.anchor?shift(input.anchor.date,input.anchor.allowSameDay?0:-1):undefined].filter((date):date is string=>!!date).sort()[0]}))
    const prepared=await prepare({...input,tasks:urgentTasks,end:horizon,anchor:undefined},true),analysis=prepared.analysis,current=settings().settings
    const testerIds=new Set([...(input.testerMemberIds??[]),...(current.groups??[]).filter(group=>group.testing).flatMap(group=>group.memberIds)])
    const issues:string[]=[],boundaries:Array<Record<string,unknown>>=[],movable:PlanningTask[]=[]
    if(reallocate) for(const task of analysis.snapshot.tasks) {
      if(task.sourceType!=='task'||isHoursCompleted(task,current.hours)||!task.startDate||!task.dueDate||task.startDate>task.dueDate||task.dueDate<analysis.context.analysisDate||task.title.includes('测试')||task.assigneeIds.some(id=>testerIds.has(id))) continue
      if(task.assigneeIds.length!==1 || !task.storyId) {issues.push(hoursTaskKey(task)+':关联需求或单一负责人不足，保持锁定');continue}
      const context=await requirementContext({workspaceId:task.projectId,entityType:'story',id:task.storyId},{testerMemberIds:[...testerIds],includeMaterials:false}).catch(()=>({status:'partial' as const}))
      if(context.status!=='complete') {issues.push(hoursTaskKey(task)+':测试边界来源不完整，保持锁定');continue}
      const testing='earliestTesting' in context?context.earliestTesting:undefined
      const testDate=testing?normalizeDateKey(testing.begin):null
      const storyDue='story' in context?normalizeDateKey((context.story as RawRow).due):null
      const latest=[horizon,testDate?shift(testDate,input.allowSameDay?0:-1):undefined,storyDue??undefined].filter((value):value is string=>!!value).sort()[0]
      const remaining=Math.max((parseHours(task.effort)??0)-(prepared.totals.get(hoursTaskKey(task))??0),0)
      if(remaining<=0) continue
      boundaries.push({taskKey:hoursTaskKey(task),storyId:task.storyId,earliestTesting:testDate,latest})
      movable.push({ref:'existing:'+hoursTaskKey(task),title:task.title,hours:remaining,memberIds:task.assigneeIds,storyId:task.storyId,projectId:task.projectId,latest,originalTaskKey:hoursTaskKey(task)})
    }
    const released=[...prepared.released,...movable.map(task=>task.originalTaskKey!)]
    const results:Array<{memberId?:string;calculationId:string;result:PlanningResult}>=[]
    const scopes=input.mode==='multi'?[undefined]:analysis.context.memberIds
    for(const memberId of scopes) {
      if(memberId&&prepared.tasks.some(task=>!task.memberIds.includes(memberId))) continue
      const tasks=[...prepared.tasks.map(task=>({...task,memberIds:memberId?[memberId]:task.memberIds})),...movable]
      const engine={...prepared.engine,tasks,capacities:capacities(analysis,released)}
      const result=planSchedule(engine)
      const calculationId=remember({analysis,analysisId:analysis.analysisId,input:{...input,tasks},result,sourceFingerprint:fingerprint(analysis),releasedTaskKeys:released,mode:'urgent',affectedTaskKeys:movable.map(task=>task.originalTaskKey!)})
      results.push({memberId,calculationId,result})
    }
    return {isSimulation:true,mode:input.mode,status:results.some(row=>row.result.status==='feasible')?'feasible':results.length&&results.every(row=>row.result.status==='infeasible')&&!issues.length?'infeasible':results.some(row=>row.result.status==='needs_information')?'needs_information':'search_incomplete',analysisId:analysis.analysisId,context:analysis.context,results,boundaries,issues,affectedTaskKeys:movable.map(task=>task.originalTaskKey!)}
  }
  function calculationView(id:string,candidateId='continuity'):TeamAnalysis {
    const calculation=getCalculation(id),base=calculation.analysis,candidate=calculation.result.candidates.find(row=>row.id===candidateId)
    if(!candidate) throw new BusinessError('CANDIDATE_NOT_FOUND')
    const view=structuredClone(base),current=settings().settings
    for(const placement of candidate.placements) {
      const planned=calculation.input.tasks.find(task=>task.ref===placement.ref)!,owner=view.members.find(member=>member.member.staffId===placement.memberId)!.member
      const original=planned.originalTaskKey?view.snapshot.tasks.find(task=>hoursTaskKey(task)===planned.originalTaskKey):undefined
      if(original) {original.startDate=placement.start;original.dueDate=placement.end;original.assigneeIds=[placement.memberId];original.assigneeId=placement.memberId;original.assigneeName=owner.name}
      else {const project=current.projects.find(project=>project.id===planned.projectId)??current.projects[0];view.snapshot.tasks.push({id:'draft:'+planned.ref,sourceType:'task',title:planned.title,projectId:project?.id??'draft',projectName:project?.alias||project?.name||'待创建',projectColor:project?.color??'#167d7f',assigneeIds:[placement.memberId],assigneeId:placement.memberId,assigneeName:owner.name,startDate:placement.start,dueDate:placement.end,status:'open',effort:String(planned.hours),hours:{estimate:planned.hours,estimateMissing:false,actual:0,actualCoverage:'cumulative',remaining:planned.hours},storyId:planned.storyId,tapdUrl:''})}
    }
    for(const member of view.members) for(const day of member.days) {
      for(const contribution of day.contributions) if(calculation.releasedTaskKeys.includes(contribution.taskKey)) contribution.allocated=0
      for(const placement of candidate.placements.filter(row=>row.memberId===member.member.staffId)) {
        const amount=placement.daily.find(row=>row.date===day.date)?.hours??0
        if(!amount) continue
        const planned=calculation.input.tasks.find(task=>task.ref===placement.ref)!,task=view.snapshot.tasks.find(task=>planned.originalTaskKey?hoursTaskKey(task)===planned.originalTaskKey:task.id==='draft:'+planned.ref)!
        const key=hoursTaskKey(task),row=day.contributions.find(row=>row.taskKey===key)
        if(row) row.allocated+=amount
        else day.contributions.push({taskKey:key,projectId:task.projectId,actual:0,allocated:amount,explanation:'本次模拟候选，未写入TAPD'})
      }
      day.allocated=day.contributions.reduce((sum,row)=>sum+row.allocated,0);day.total=day.actual+(day.basis==='forecast'?day.allocated:0);day.deficit=Math.max(day.target-day.total,0);day.available=Math.max(day.target-day.total,0)
      day.state=day.reasons.length?'unknown':day.target===0?'exempt':day.deficit>1e-8?'short':day.total>day.target?'over':'enough'
    }
    view.risks=checkRisks(view.snapshot,view.members,current,base.context.analysisDate,'mcp')
    view.limitations.push('模拟结果：日期和分配尚未写入TAPD；原始分析 '+base.analysisId)
    return view
  }
  interface BatchItem {ref:string;workspaceId:string;id?:string;expectedDigest?:string;fields:Record<string,string>}
  interface BatchReceipt extends OperationReceipt {batchId?:string;itemKey?:string;attempt?:number;intentHash?:string}
  function receipts(batchKey:string):BatchReceipt[] {
    const rows=store.db.prepare("SELECT value FROM operations WHERE json_extract(value, '$.batchId')=?").all(digest(batchKey)) as Array<{value:string}>
    return rows.map(row=>JSON.parse(row.value)).sort((a,b)=>(a.attempt??0)-(b.attempt??0))
  }
  async function getTaskBatch(batchKey:string) {
    const all=receipts(batchKey),latest=new Map<string,BatchReceipt>()
    for(const row of all) {business.assertProject(settings().settings,row.workspaceId);latest.set(row.itemKey!,row)}
    const items=[]
    for(let receipt of latest.values()) {
      if(receipt.status==='unknown'&&receipt.remoteId) {await business.verifyOperation(receipt.operationId).catch(()=>{});receipt=business.files.getOperation(receipt.operationId) as BatchReceipt}
      let actual:unknown
      if(receipt.status==='succeeded'&&receipt.remoteId) actual=(await business.readItem({workspaceId:receipt.workspaceId,entityType:'task',id:receipt.remoteId}).catch(()=>undefined))?.item
      items.push({...receipt,ref:receipt.itemKey,tapdUrl:receipt.remoteId?urlFor(receipt.workspaceId,'task',receipt.remoteId):undefined,actual})
    }
    return {batchKey,status:items.length&&items.every(item=>item.status==='succeeded')?'succeeded':'partial',items,attempts:all.length}
  }
  async function writeTasks(input:{batchKey:string;items:BatchItem[];calculationId?:string;candidateId?:string;retryFailed?:boolean}) {
    if(batchLocks.has(input.batchKey)) throw new BusinessError('BATCH_BUSY')
    batchLocks.add(input.batchKey)
    try {
      if(new Set(input.items.map(item=>item.ref)).size!==input.items.length) throw new BusinessError('DUPLICATE_ITEM_REF')
      const all=receipts(input.batchKey),latest=new Map<string,BatchReceipt>();for(const row of all) latest.set(row.itemKey!,row)
      for(const item of input.items) {const previous=latest.get(item.ref);if(previous&&previous.status!=='failed'&&(previous.workspaceId!==item.workspaceId||item.id&&item.id!==previous.remoteId||Object.entries(fieldHashes(item.fields)).some(([key,hash])=>previous.expectedHashes[key]!==hash))) throw new BusinessError('BATCH_ITEM_CONFLICT')}
      const pending=input.items.filter(item=>!latest.has(item.ref)||latest.get(item.ref)!.status==='failed'&&input.retryFailed)
      if(!pending.length) return getTaskBatch(input.batchKey)
      const calculation=input.calculationId?getCalculation(input.calculationId):undefined
      if(calculation?.mode==='urgent') throw new BusinessError('SIMULATION_IS_READ_ONLY')
      if(!calculation&&pending.some(item=>item.fields.begin||item.fields.due)) throw new BusinessError('SCHEDULE_CALCULATION_REQUIRED')
      if(calculation) {
        const fresh=await business.analyze({...calculation.analysis.context.range,analysisDate:calculation.analysis.context.analysisDate,memberIds:calculation.analysis.context.memberIds,refresh:true})
        if(fingerprint(fresh)!==calculation.sourceFingerprint) throw new BusinessError('STALE_PLAN',{freshAnalysisId:fresh.analysisId,recalculated:await plan(calculation.input)})
      }
      const candidate=calculation?.result.candidates.find(row=>row.id===(input.candidateId??'continuity'))
      if(calculation&&!candidate) throw new BusinessError('CANDIDATE_NOT_FOUND')
      const prepared=[]
      for(const item of input.items) {
        const previous=latest.get(item.ref),fields={...item.fields}
        if(previous&&previous.status!=='failed') {prepared.push({item,fields,previous,intentHash:previous.intentHash});continue}
        const placement=candidate?.placements.find(row=>row.ref===item.ref)
        const owner=await member(placement?.memberId??fields.owner)
        fields.owner=owner.account!
        if(placement) {
          if(fields.begin&&fields.begin!==placement.start||fields.due&&fields.due!==placement.end) throw new BusinessError('PLAN_FIELDS_MISMATCH')
          fields.begin=placement.start;fields.due=placement.end
          const planned=calculation!.input.tasks.find(task=>task.ref===item.ref)
          if(planned?.projectId && planned.projectId!==item.workspaceId || planned?.storyId && fields.story_id && planned.storyId!==fields.story_id) throw new BusinessError('PLAN_TARGET_MISMATCH')
          if(!planned || item.id&&planned.originalTaskKey!==item.workspaceId+':task:'+item.id || !item.id&&planned.originalTaskKey) throw new BusinessError('PLAN_TARGET_MISMATCH')
          const original=item.id?calculation!.analysis.snapshot.tasks.find(task=>task.id===item.id&&task.projectId===item.workspaceId):undefined
          const spent=original?calculation!.analysis.snapshot.records.filter(row=>row.projectId===item.workspaceId&&row.entityType==='task'&&row.entityId===item.id&&row.spentDate<=calculation!.analysis.context.analysisDate).reduce((sum,row)=>sum+row.hours,0):0
          if(Math.abs(Math.max((parseHours(fields.effort??original?.effort)??0)-spent,0)-placement.daily.reduce((sum,day)=>sum+day.hours,0))>1e-8) throw new BusinessError('PLAN_EFFORT_MISMATCH')
        } else if(calculation) throw new BusinessError('PLAN_TARGET_MISMATCH')
        if(!item.id&&!fields.story_id) throw new BusinessError('STORY_REQUIRED')
        const intentHash=digest({workspaceId:item.workspaceId,id:item.id,fields:fieldHashes(fields)})
        if(previous?.intentHash&&previous.intentHash!==intentHash&&!input.retryFailed) throw new BusinessError('BATCH_ITEM_CONFLICT')
        if(item.id&&!item.expectedDigest) throw new BusinessError('EXPECTED_DIGEST_REQUIRED')
        prepared.push({item,fields,previous,intentHash})
      }
      // Validate every resumed item before emitting the first mutation.
      for(const {item,fields,previous,intentHash} of prepared) {
        if(previous&&previous.status!=='failed') {
          const expected=fieldHashes(fields)
          if(Object.entries(expected).some(([field,hash])=>previous.expectedHashes[field]!==hash)) throw new BusinessError('BATCH_ITEM_CONFLICT')
          continue
        }
        if(previous&&!input.retryFailed) continue
        const attempt=(previous?.attempt??0)+1
        try {
          await business.write({workspaceId:item.workspaceId,entityType:'task',id:item.id,expectedDigest:item.expectedDigest,fields,idempotencyKey:'batch-'+digest([input.batchKey,item.ref,attempt]),actor:'batch',batch:{batchId:digest(input.batchKey),itemKey:item.ref,attempt,intentHash}},item.id?'update':'create')
        } catch(error) {
          const reserved=business.files.reserveOperation({idempotencyKey:'batch-'+digest([input.batchKey,item.ref,attempt]),requestHash:digest({intentHash,preflight:true}),workspaceId:item.workspaceId,entityType:'task',action:item.id?'update':'create',actor:'local-user:batch',expectedHashes:fieldHashes(fields),remoteId:item.id,batchId:digest(input.batchKey),itemKey:item.ref,attempt,intentHash})
          if(reserved.fresh) business.files.updateOperation(reserved.receipt.operationId,{status:'failed',code:error instanceof BusinessError?error.code:'BATCH_WRITE_FAILED',batchId:digest(input.batchKey),itemKey:item.ref,attempt,intentHash})
        }
      }
      return getTaskBatch(input.batchKey)
    } finally {batchLocks.delete(input.batchKey)}
  }
  return {getConfig,updateConfig,syncProjects,resolveMembers,requirementContext,workContext,plan,urgent,getCalculation,calculationView,writeTasks,getTaskBatch,capacities}
}
export type TeamSightScenarios=ReturnType<typeof createScenarios>
