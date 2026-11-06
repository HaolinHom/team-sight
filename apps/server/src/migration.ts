import Database from 'better-sqlite3'
import { randomUUID, createHash } from 'node:crypto'
import { mkdirSync, existsSync, writeFileSync, readFileSync, readdirSync, cpSync, rmSync, chmodSync, realpathSync } from 'node:fs'
import { join, resolve, relative, isAbsolute, dirname, basename } from 'node:path'
import { normalizeSettings } from '@teamsight/core'
import { StorageError, systemVault, type Vault } from './storage.js'

// Explicit offline upgrade; never a fallback in the server startup path.
export async function migrateStore(from:string,to:string,options:{sourceVault?:Vault;targetVault?:Vault}={}) {
  const source=realpathSync(resolve(from)),target=join(realpathSync(dirname(resolve(to))),basename(resolve(to)))
  const inside=relative(source,target)
  if (!inside || !inside.startsWith('..') && !isAbsolute(inside)) throw new StorageError('MIGRATION_INVALID_TARGET')
  if (existsSync(target)) throw new StorageError('MIGRATION_TARGET_EXISTS')
  const sourceLock=join(source,'instance.lock')
  try {writeFileSync(sourceLock,JSON.stringify({pid:process.pid,migration:true}),{flag:'wx',mode:0o600})}
  catch {throw new StorageError('MIGRATION_SOURCE_LOCKED')}
  const oldVault=options.sourceVault??systemVault('TeamSight.P0'),newVault=options.targetVault??systemVault()
  let db:Database.Database|undefined,dest:Database.Database|undefined,newAccount:string|undefined,created=false
  try {
    db=new Database(join(source,'probe.sqlite'),{readonly:true,fileMustExist:true})
    if(db.pragma('user_version',{simple:true})!==3) throw new StorageError('MIGRATION_SOURCE_SCHEMA_UNSUPPORTED')
    const row=db.prepare('SELECT revision,value,updated_at FROM settings WHERE id=1').get() as {revision:number;value:string;updated_at:string}
    const settings=JSON.parse(row.value)
    if(settings.schemaVersion!==5) throw new StorageError('MIGRATION_SOURCE_SETTINGS_UNSUPPORTED')
    const oldAccount=(db.prepare('SELECT credential_account FROM config WHERE id=1').get() as {credential_account:string|null}).credential_account
    mkdirSync(target,{mode:0o700});created=true
    writeFileSync(join(target,'.migration'),'offline migration',{flag:'wx',mode:0o600})
    writeFileSync(join(target,'instance.lock'),JSON.stringify({pid:process.pid,migration:true}),{flag:'wx',mode:0o600})
    for(const entry of readdirSync(source,{withFileTypes:true})) {
      if(['probe.sqlite','probe.sqlite-wal','probe.sqlite-shm','instance.lock','instance.json','.migration'].includes(entry.name)) continue
      if(entry.isSymbolicLink()) throw new StorageError('MIGRATION_SOURCE_SYMLINK')
      cpSync(join(source,entry.name),join(target,entry.name),{recursive:true,dereference:false,errorOnExist:true,force:false})
    }
    await db.backup(join(target,'teamsight.sqlite'))
    dest=new Database(join(target,'teamsight.sqlite'))
    if(dest.pragma('integrity_check',{simple:true})!=='ok') throw new StorageError('MIGRATION_DATABASE_INVALID')
    const normalized=normalizeSettings(settings).settings
    normalized.updatedAt=settings.updatedAt
    dest.transaction(()=>{
      dest!.exec('ALTER TABLE settings DROP COLUMN imported_from; CREATE TABLE credentials (id INTEGER PRIMARY KEY CHECK (id=1), account TEXT); DROP TABLE config;')
      dest!.prepare('UPDATE settings SET value=? WHERE id=1').run(JSON.stringify(normalized))
      dest!.prepare('INSERT INTO credentials VALUES (1, NULL)').run()
      dest!.pragma('user_version = 4')
    })()
    if(oldAccount) {
      let credential:string|null
      try {credential=oldVault.get(oldAccount)} catch {throw new StorageError('MIGRATION_KEYRING_READ_FAILED')}
      if(!credential) throw new StorageError('MIGRATION_CREDENTIAL_MISSING')
      newAccount='tapd-'+randomUUID()
      dest.prepare('UPDATE credentials SET account=? WHERE id=1').run(newAccount)
      try {newVault.put(newAccount,credential);if(newVault.get(newAccount)!==credential) throw new Error()}
      catch {throw new StorageError('MIGRATION_KEYRING_WRITE_FAILED')}
    }
    for(const table of ['settings','tapd_cache','operations','documents','jobs']) {
      const count=(database:Database.Database)=>(database.prepare('SELECT count(*) AS n FROM '+table).get() as {n:number}).n
      if(count(db)!==count(dest)) throw new StorageError('MIGRATION_RECORD_MISMATCH')
    }
    const hash=(path:string)=>createHash('sha256').update(readFileSync(path)).digest('hex')
    const compareTree=(path:string)=>{
      for(const entry of readdirSync(join(source,path),{withFileTypes:true})) {
        const file=join(path,entry.name)
        if(entry.isSymbolicLink()) throw new StorageError('MIGRATION_SOURCE_SYMLINK')
        if(entry.isDirectory())compareTree(file)
        else if(hash(join(source,file))!==hash(join(target,file)))throw new StorageError('MIGRATION_FILE_MISMATCH')
      }
    }
    if(existsSync(join(source,'files')))compareTree('files')
    if(hash(join(source,'access-token'))!==hash(join(target,'access-token')))throw new StorageError('MIGRATION_TOKEN_MISMATCH')
    dest.close();dest=undefined;db.close();db=undefined
    if(process.platform!=='win32') {chmodSync(join(target,'teamsight.sqlite'),0o600);chmodSync(join(target,'access-token'),0o600)}
    rmSync(join(target,'.migration'));rmSync(join(target,'instance.lock'))
    return {ok:true,revision:row.revision,schemaVersion:6,databaseVersion:4,credentialPresent:!!newAccount,sourcePreserved:true}
  } catch(error) {
    dest?.close();dest=undefined;db?.close();db=undefined
    let cleanupFailed=false
    if(newAccount)try{newVault.remove(newAccount)}catch{cleanupFailed=true}
    if(created&&!cleanupFailed)rmSync(target,{recursive:true,force:true})
    if(cleanupFailed)throw new StorageError('MIGRATION_CREDENTIAL_CLEANUP_REQUIRED: target remains locked; source is unchanged')
    if(error instanceof StorageError)throw error
    throw new StorageError('MIGRATION_FAILED: source is unchanged')
  } finally {dest?.close();db?.close();rmSync(sourceLock,{force:true})}
}
