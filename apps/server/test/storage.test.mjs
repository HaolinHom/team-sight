import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request } from 'node:http'
import { openStore } from '../dist/storage.js'
import { runtimeProblem } from '../dist/runtime.js'
import { startServer, SETTINGS_UI_URI } from '../dist/server.js'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'

function fixture() {
 const dir=mkdtempSync(join(tmpdir(),'teamsight-storage-')),secrets=new Map()
 const vault={put:(id,value)=>secrets.set(id,value),get:id=>secrets.get(id)??null,remove:id=>secrets.delete(id)}
 return {dir,secrets,vault,cleanup:()=>rmSync(dir,{recursive:true,force:true})}
}
test('runtime rejects incompatible Node and Node-API',()=>{
 assert.equal(runtimeProblem('22.23.2','10'),null)
 for(const pair of [['20.19.0','9'],['22.13.0','10'],['24.0.0','10'],['22.23.4','9']])assert.match(runtimeProblem(...pair),/NODE_UNSUPPORTED/)
})
test('new persisted defaults survive credential setup, restart and deliberate opt-out',()=>{
 const f=fixture();let store=openStore(f.dir,f.vault)
 try {
  const initial=store.readSettings()
  assert.equal(initial.revision,0)
  assert.equal(initial.settings.chinaCalendar.enabled,true)
  assert.deepEqual(initial.settings.tapd.writeAccess.operations,['create','update','comment'])
  assert.equal(initial.settings.tapd.writeAccess.fields.length,8)
  const saved=store.saveSettings({expectedRevision:0,credential:'DEFAULTS_FIXTURE',patch:{}})
  store.close();store=openStore(f.dir,f.vault)
  assert.deepEqual(store.readSettings(),saved)
  const disabled=store.saveSettings({expectedRevision:saved.revision,patch:{tapd:{defaultTypes:[],writeAccess:{operations:[],fields:[]}},chinaCalendar:{enabled:false}}})
  store.close();store=openStore(f.dir,f.vault)
  assert.deepEqual(store.readSettings(),disabled)
  // Simulate an old v6 database which never stored writeAccess or calendar preferences.
  const raw=JSON.parse(store.db.prepare('SELECT value FROM settings WHERE id=1').get().value)
  delete raw.tapd.writeAccess;delete raw.chinaCalendar
  store.db.prepare('UPDATE settings SET value=? WHERE id=1').run(JSON.stringify(raw))
  store.close();store=openStore(f.dir,f.vault)
  const old=store.readSettings()
  assert.deepEqual(old.settings.tapd.writeAccess,{operations:[],fields:[]})
  assert.equal(old.settings.chinaCalendar.enabled,false)
  assert.equal(old.revision,disabled.revision)
 }finally{store.clearCredential();store.close();f.cleanup()}
})
test('formal settings CAS, write rollback, credential compensation and restart',()=>{
 const f=fixture();let store=openStore(f.dir,f.vault)
 try {
  const first=store.saveSettings({expectedRevision:0,patch:{teamName:'修订一'},credential:'FIXTURE_SECRET'})
  assert.equal(first.revision,1);assert.equal(f.secrets.size,1)
  assert.throws(()=>store.saveSettings({expectedRevision:0,patch:{teamName:'冲突'},credential:'STALE'}),/REVISION_CONFLICT/)
  store.db.exec("CREATE TRIGGER fail_save BEFORE UPDATE ON credentials BEGIN SELECT RAISE(ABORT,'fixture failure'); END")
  assert.throws(()=>store.saveSettings({expectedRevision:1,patch:{teamName:'回滚'},credential:'NEW_SECRET'}),/STORAGE_WRITE_FAILED/)
  assert.deepEqual(store.readSettings(),first);assert.equal(store.getCredential(),'FIXTURE_SECRET');assert.equal(f.secrets.size,1)
  store.db.exec('DROP TRIGGER fail_save');store.db.pragma('query_only=ON')
  assert.throws(()=>store.saveSettings({expectedRevision:1,patch:{teamName:'失败'}}),/STORAGE_WRITE_FAILED/)
  store.close();store=openStore(f.dir,f.vault)
  assert.deepEqual(store.readSettings(),first)
  assert.equal(store.db.pragma('user_version',{simple:true}),4)
  assert.equal(store.db.prepare("SELECT name FROM sqlite_master WHERE name='config'").get(),undefined)
  assert.ok(!readFileSync(join(f.dir,'teamsight.sqlite')).includes(Buffer.from('FIXTURE_SECRET')))
 }finally{store.clearCredential();store.close();f.cleanup()}
})
test('bounded database lock wait does not commit a failed write',()=>{
 const f=fixture(),store=openStore(f.dir,f.vault),rival=openStore(f.dir,f.vault)
 try {
  rival.db.exec('BEGIN IMMEDIATE');const start=performance.now()
  assert.throws(()=>store.saveSettings({expectedRevision:0,patch:{teamName:'blocked'}}),/STORAGE_WRITE_FAILED/)
  const waited=performance.now()-start;assert.ok(waited>=800&&waited<5000)
  rival.db.exec('ROLLBACK');assert.equal(store.readSettings().revision,0)
 }finally{rival.close();store.close();f.cleanup()}
})
test('partial settings save preserves custom write fields and rejects retired config',()=>{
 const f=fixture(),store=openStore(f.dir,f.vault)
 try {
  const first=store.saveSettings({expectedRevision:0,patch:{tapd:{writeAccess:{operations:['create'],fields:['name','custom_field']}}}})
  const next=store.saveSettings({expectedRevision:first.revision,patch:{hours:{dailyRequiredHours:7},tapd:{writeAccess:{fields:['name','custom_field','effort']}}}})
  assert.equal(next.settings.hours.dailyRequiredHours,7);assert.deepEqual(next.settings.tapd.writeAccess.operations,['create'])
  for(const patch of [{hours:{exemptions:[]}},{tapd:{workspaceIds:[]}},{tapd:{writeAccess:{workspaceIds:[]}}}])assert.throws(()=>store.saveSettings({expectedRevision:next.revision,patch}),/INVALID_CONFIG/)
  assert.equal(store.readSettings().revision,next.revision)
  store.putCache('fixture','2026-11-06','complete',{tasks:[]});assert.deepEqual(store.getCache('fixture').value,{tasks:[]})
 }finally{store.close();f.cleanup()}
})
test('old databases and in-progress migration never initialize a new store',()=>{
 const f=fixture()
 try {
  writeFileSync(join(f.dir,'.migration'),'busy');assert.throws(()=>openStore(f.dir),/MIGRATION_IN_PROGRESS/)
  rmSync(join(f.dir,'.migration'));writeFileSync(join(f.dir,'probe.sqlite'),'old')
  assert.throws(()=>openStore(f.dir),/MIGRATION_REQUIRED/)
 }finally{f.cleanup()}
})
test('current HTTP clients share settings, enforce auth, expose only current resources and survive restart',async()=>{
 const f=fixture(),occupied=fixture();let service=await startServer({dataDir:f.dir,port:0,vault:f.vault})
 const connections=[]
 async function connect(){
  const client=new Client({name:'current-contract-test',version:'1'}),transport=new StreamableHTTPClientTransport(new URL(service.info.url),{requestInit:{headers:{Authorization:'Bearer '+readFileSync(join(f.dir,'access-token'),'utf8').trim()}}})
  await client.connect(transport);connections.push({client,transport});return client
 }
 const call=(c,name,args={})=>c.callTool({name,arguments:args})
 async function disconnect(){for(const c of connections.splice(0)){await c.transport.terminateSession().catch(()=>{});await c.client.close()}}
 try {
  await assert.rejects(startServer({dataDir:f.dir,port:0,vault:f.vault}),/INSTANCE_LOCKED/)
  await assert.rejects(startServer({dataDir:occupied.dir,port:Number(new URL(service.info.url).port),vault:f.vault}),/PORT_IN_USE/)
  const token=readFileSync(join(f.dir,'access-token'),'utf8').trim(),headers={Authorization:'Bearer '+token}
  assert.equal((await fetch(service.info.url)).status,401)
  const badHost=await new Promise((ok,fail)=>{const req=request(service.info.url,{headers:{...headers,Host:'evil.test'}},res=>{res.resume();ok(res.statusCode)});req.on('error',fail);req.end()})
  assert.equal(badHost,403)
  for(const Origin of ['null','https://evil.test','http://127.0.0.1:9999'])assert.equal((await fetch(service.info.url,{headers:{...headers,Origin}})).status,403)
  const [a,b]=await Promise.all([connect(),connect()])
  assert.equal((await call(a,'teamsight_status')).structuredContent.instanceId,(await call(b,'teamsight_status')).structuredContent.instanceId)
  const tools=(await a.listTools()).tools
  for(const old of ['teamsight_import_settings','tapd_list_workspaces'])assert.ok(!tools.some(t=>t.name===old))
  assert.ok(!tools.some(t=>t.name.startsWith('teamsight_probe_')))
  assert.ok(tools.some(t=>t.name==='teamsight_open_settings'&&t._meta.ui.resourceUri===SETTINGS_UI_URI))
  const resources=(await a.listResources()).resources.map(r=>r.uri)
  assert.deepEqual(resources.sort(),[SETTINGS_UI_URI,'ui://teamsight/analysis-0.3.4.html'].sort())
  const resource=await a.readResource({uri:SETTINGS_UI_URI});assert.equal(resource.contents[0].mimeType,'text/html;profile=mcp-app');assert.doesNotMatch(resource.contents[0].text,/<script[^>]*\bsrc=/)
  const saved=await call(a,'teamsight_save_settings',{expectedRevision:0,patch:{teamName:'并发会话'}})
  assert.equal(saved.structuredContent.revision,1)
  const conflict=await call(b,'teamsight_save_settings',{expectedRevision:0,patch:{teamName:'stale'}})
  assert.equal(conflict.structuredContent.code,'REVISION_CONFLICT')
  for(const target of ['write','general','leave','import'])assert.equal((await call(a,'teamsight_open_settings',{target})).isError,true)
  assert.equal((await fetch(new URL('/_p0/stop',service.info.url),{method:'POST',headers})).status,404)
  await disconnect();await service.close();service=await startServer({dataDir:f.dir,port:0,vault:f.vault})
  const c=await connect();assert.equal((await call(c,'teamsight_get_config')).structuredContent.settings.teamName,'并发会话')
  await disconnect()
  assert.equal((await fetch(new URL('/_internal/stop',service.info.url),{method:'POST',headers})).status,200)
 }finally{await disconnect();await service.close();f.cleanup();occupied.cleanup()}
})
