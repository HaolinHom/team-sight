import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createHash} from 'node:crypto'
import {migrateStore} from '../dist/migration.js'
import {openStore} from '../dist/storage.js'
import {startServer} from '../dist/server.js'
import {createDefaultSettings} from '@teamsight/core'
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex')
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'teamsight-migrate-')),from=join(root,'source'),to=join(root,'target');mkdirSync(from);mkdirSync(join(from,'files'))
 const settings={...createDefaultSettings(),schemaVersion:5,teamName:'保留配置',members:[{staffId:'100',name:'A'}],groups:[{id:'default',name:'默认',memberIds:['100']}],hours:{dailyRequiredHours:7.5,exemptions:[{staffId:'100',date:'2026-11-06',hours:2}],completedStates:[]},tapd:{baseUrl:'https://api.tapd.cn',workspaceIds:['1'],defaultTypes:['task'],writeAccess:{workspaceIds:['1'],operations:['create'],fields:['name','custom']}}}
 const db=new Database(join(from,'probe.sqlite'))
 db.exec(`CREATE TABLE config(id INTEGER PRIMARY KEY,revision INTEGER,value TEXT,credential_account TEXT);
 CREATE TABLE settings(id INTEGER PRIMARY KEY,revision INTEGER,value TEXT,imported_from TEXT,updated_at TEXT);
 CREATE TABLE tapd_cache(cache_key TEXT PRIMARY KEY,fetched_at TEXT,status TEXT,value TEXT);
 CREATE TABLE operations(operation_id TEXT PRIMARY KEY,idempotency_key TEXT UNIQUE,request_hash TEXT,status TEXT,value TEXT);
 CREATE TABLE documents(id TEXT PRIMARY KEY,kind TEXT,value TEXT); CREATE TABLE jobs(id TEXT PRIMARY KEY,status TEXT,value TEXT); PRAGMA user_version=3;`)
 db.prepare('INSERT INTO config VALUES(1,23,?,?)').run('{}','old-account')
 db.prepare('INSERT INTO settings VALUES(1,23,?,NULL,?)').run(JSON.stringify(settings),settings.updatedAt)
 db.prepare('INSERT INTO operations VALUES(?,?,?,?,?)').run('op','stable-key','hash','unknown','{"status":"unknown"}')
 db.prepare('INSERT INTO documents VALUES(?,?,?)').run('historical','analysis','{"id":"historical"}');db.close()
 writeFileSync(join(from,'files','historical.json'),'{"context":{"rulesVersion":"teamsight-hours-v1.2"},"members":[]}')
 writeFileSync(join(from,'access-token'),'a'.repeat(64))
 const oldSecrets=new Map([['old-account','ISOLATED_SECRET']]),newSecrets=new Map(),vault=map=>({put:(id,value)=>map.set(id,value),get:id=>map.get(id)??null,remove:id=>map.delete(id)})
 return {root,from,to,settings,oldSecrets,newSecrets,options:{sourceVault:vault(oldSecrets),targetVault:vault(newSecrets)},cleanup:()=>rmSync(root,{recursive:true,force:true})}
}
test('offline migration preserves source, revision, receipts, exact files and secrets outside SQLite',async()=>{
 const f=fixture(),dbHash=hash(join(f.from,'probe.sqlite')),fileHash=hash(join(f.from,'files/historical.json'))
 try{
  const result=await migrateStore(f.from,f.to,f.options);assert.equal(result.revision,23)
  assert.equal(hash(join(f.from,'probe.sqlite')),dbHash);assert.equal(hash(join(f.to,'files/historical.json')),fileHash)
  assert.equal(hash(join(f.from,'access-token')),hash(join(f.to,'access-token')))
  assert.equal(f.oldSecrets.get('old-account'),'ISOLATED_SECRET');assert.equal(f.newSecrets.size,1)
  const store=openStore(f.to,f.options.targetVault)
  try{
   const current=store.readSettings();assert.equal(current.revision,23);assert.equal(current.settings.schemaVersion,6);assert.equal(current.settings.teamName,f.settings.teamName)
   assert.equal('exemptions' in current.settings.hours,false);assert.equal('workspaceIds' in current.settings.tapd,false);assert.equal('workspaceIds' in current.settings.tapd.writeAccess,false)
   assert.deepEqual(current.settings.tapd.writeAccess.fields,['name','custom']);assert.equal(store.getCredential(),'ISOLATED_SECRET')
   assert.equal(store.db.prepare('SELECT status FROM operations').get().status,'unknown')
  }finally{store.close()}
  assert.ok(!readFileSync(join(f.to,'teamsight.sqlite')).includes(Buffer.from('ISOLATED_SECRET')))
  await assert.rejects(migrateStore(f.from,f.to,f.options),/TARGET_EXISTS/)
 }finally{f.cleanup()}
})
test('source instance lock and target conflicts never change source',async()=>{
 const f=fixture();try{
  writeFileSync(join(f.from,'instance.lock'),'running')
  await assert.rejects(migrateStore(f.from,f.to,f.options),/SOURCE_LOCKED/)
  assert.equal(readFileSync(join(f.from,'instance.lock'),'utf8'),'running');assert.equal(existsSync(f.to),false)
  rmSync(join(f.from,'instance.lock'));mkdirSync(f.to)
  await assert.rejects(migrateStore(f.from,f.to,f.options),/TARGET_EXISTS/)
  await assert.rejects(migrateStore(f.from,join(f.from,'nested'),f.options),/INVALID_TARGET/)
 }finally{f.cleanup()}
})
test('keyring write, verification and database failures clean destination and retain source',async()=>{
 for(const failure of ['put','verify','database','missing']){
  const f=fixture(),before=hash(join(f.from,'probe.sqlite'))
  try{
   if(failure==='database'){const db=new Database(join(f.from,'probe.sqlite'));db.exec('DROP TABLE jobs');db.close()}
   if(failure==='missing')f.oldSecrets.clear()
   if(failure==='put')f.options.targetVault.put=()=>{throw new Error('secret-bearing-native-error')}
   if(failure==='verify')f.options.targetVault.get=()=>null
   await assert.rejects(migrateStore(f.from,f.to,f.options),/MIGRATION_/)
   assert.equal(existsSync(f.to),false);assert.equal(existsSync(join(f.from,'instance.lock')),false);assert.equal(f.newSecrets.size,0)
   if(failure!=='database')assert.equal(hash(join(f.from,'probe.sqlite')),before)
  }finally{f.cleanup()}
 }
})
test('target stays locked while asynchronous database backup is pending',async()=>{
 const f=fixture();try{
  const pending=migrateStore(f.from,f.to,f.options)
  await assert.rejects(startServer({dataDir:f.to,port:0,vault:f.options.targetVault}),/MIGRATION_IN_PROGRESS|INSTANCE_LOCKED/)
  await pending
 }finally{f.cleanup()}
})
test('unsupported source versions require manual handling without creating a destination',async()=>{
 for(const kind of ['database','settings']){
  const f=fixture();try{
   const db=new Database(join(f.from,'probe.sqlite'))
   if(kind==='database')db.pragma('user_version=2')
   else db.prepare('UPDATE settings SET value=?').run(JSON.stringify({...f.settings,schemaVersion:4}))
   db.close()
   await assert.rejects(migrateStore(f.from,f.to,f.options),/UNSUPPORTED/)
   assert.equal(existsSync(f.to),false)
  }finally{f.cleanup()}
 }
})
test('failed credential cleanup keeps target locked and returns a recoverable error',async()=>{
 const f=fixture();try{
  f.options.targetVault.get=()=>null
  f.options.targetVault.remove=()=>{throw new Error('vault unavailable')}
  await assert.rejects(migrateStore(f.from,f.to,f.options),/CREDENTIAL_CLEANUP_REQUIRED/)
  assert.equal(existsSync(join(f.to,'.migration')),true)
  assert.throws(()=>openStore(f.to,f.options.targetVault),/MIGRATION_IN_PROGRESS/)
  assert.equal(f.oldSecrets.get('old-account'),'ISOLATED_SECRET')
 }finally{f.cleanup()}
})
