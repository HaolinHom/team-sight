import Database from 'better-sqlite3'
import { Entry } from '@napi-rs/keyring'
import { randomUUID } from 'node:crypto'
import { mkdirSync, chmodSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createDefaultSettings, normalizeSettings, SETTINGS_SCHEMA_VERSION, type TeamSightSettings } from '@teamsight/core'

export class StorageError extends Error {
  constructor(public code: string) { super(code) }
}
export interface Vault {
  put(account: string, value: string): void
  get(account: string): string | null
  remove(account: string): void
}
export interface SettingsSnapshot {
  revision: number
  settings: TeamSightSettings
  credentialPresent: boolean
  warning?: string
}
export type SettingsPatch = Omit<Partial<TeamSightSettings>, 'hours'|'chinaCalendar'|'tapd'> & {
 hours?: Partial<TeamSightSettings['hours']>
 chinaCalendar?: Partial<TeamSightSettings['chinaCalendar']>
 tapd?: Omit<Partial<TeamSightSettings['tapd']>,'writeAccess'> & {writeAccess?:Partial<NonNullable<TeamSightSettings['tapd']['writeAccess']>>}
}
export interface TeamSightStore {
  db: Database.Database
  clearCredential(): void
  getCredential(): string | null
  readSettings(): SettingsSnapshot
  saveSettings(input: { expectedRevision: number; patch: SettingsPatch; credential?: string }): SettingsSnapshot
  getCache(key: string): { fetchedAt: string; status: string; value: unknown } | null
  putCache(key: string, fetchedAt: string, status: string, value: unknown): void
  close(): void
}
export function systemVault(service = 'TeamSight.MCP'): Vault {
  return {
    put: (account, value) => new Entry(service, account).setPassword(value),
    get: account => new Entry(service, account).getPassword(),
    remove: account => { new Entry(service, account).deletePassword() },
  }
}

export function openStore(dir: string, vault?: Vault): TeamSightStore {
  if (existsSync(join(dir, '.migration'))) throw new StorageError('MIGRATION_IN_PROGRESS')
  if (existsSync(join(dir, 'probe.sqlite'))) throw new StorageError('MIGRATION_REQUIRED: run migrate --from OLD --to NEW')
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const db = new Database(join(dir, 'teamsight.sqlite'))
  try {
    if (process.platform !== 'win32') chmodSync(join(dir, 'teamsight.sqlite'), 0o600)
    db.pragma('journal_mode = WAL')
    db.pragma('busy_timeout = 1000')
    db.transaction(() => {
      const version = db.pragma('user_version', { simple: true }) as number
      if (version !== 0 && version !== 4) throw new StorageError(version > 4 ? 'SCHEMA_TOO_NEW' : 'MIGRATION_REQUIRED')
      if (version === 0) {
        db.exec(`CREATE TABLE settings (id INTEGER PRIMARY KEY CHECK (id=1), revision INTEGER NOT NULL, value TEXT NOT NULL, updated_at TEXT NOT NULL);
          CREATE TABLE credentials (id INTEGER PRIMARY KEY CHECK (id=1), account TEXT);
          CREATE TABLE tapd_cache (cache_key TEXT PRIMARY KEY, fetched_at TEXT NOT NULL, status TEXT NOT NULL, value TEXT NOT NULL);
          CREATE TABLE operations (operation_id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE, request_hash TEXT NOT NULL, status TEXT NOT NULL, value TEXT NOT NULL);
          CREATE TABLE documents (id TEXT PRIMARY KEY, kind TEXT NOT NULL, value TEXT NOT NULL);
          CREATE TABLE jobs (id TEXT PRIMARY KEY, status TEXT NOT NULL, value TEXT NOT NULL)`)
        const initial = createDefaultSettings()
        db.prepare('INSERT INTO settings VALUES (1, 0, ?, ?)').run(JSON.stringify(initial), initial.updatedAt)
        db.prepare('INSERT INTO credentials VALUES (1, NULL)').run()
        db.pragma('user_version = 4')
      }
      const stored = db.prepare('SELECT value FROM settings WHERE id=1').get() as {value:string}
      if (JSON.parse(stored.value).schemaVersion !== SETTINGS_SCHEMA_VERSION) throw new StorageError('SETTINGS_SCHEMA_UNSUPPORTED')
    })()
  } catch (error) { db.close(); throw error }
  const secretVault = vault ?? systemVault()
  const account = () => (db.prepare('SELECT account FROM credentials WHERE id=1').get() as {account:string|null}).account
  function readSettings(): SettingsSnapshot {
    const row = db.prepare('SELECT revision, value FROM settings WHERE id=1').get() as {revision:number;value:string}
    return { revision: row.revision, settings: normalizeSettings(JSON.parse(row.value)).settings, credentialPresent: !!account() }
  }
  function getCredential() {
    const id = account()
    if (!id) return null
    try { return secretVault.get(id) } catch { throw new StorageError('KEYRING_READ_FAILED') }
  }
  function clearCredential() {
    const id = account()
    if (!id) return
    secretVault.remove(id)
    db.transaction(() => {
      db.prepare('UPDATE credentials SET account=NULL WHERE id=1').run()
      const current = readSettings().settings
      const now = new Date().toISOString()
      db.prepare('UPDATE settings SET revision=revision+1, value=?, updated_at=? WHERE id=1').run(JSON.stringify({...current,updatedAt:now}),now)
    }).immediate()
  }
  function saveSettings(input: {expectedRevision:number;patch:SettingsPatch;credential?:string}): SettingsSnapshot {
    let newAccount: string | undefined
    let previousAccount: string | null = null
    try {
      if (readSettings().revision !== input.expectedRevision) throw new StorageError('REVISION_CONFLICT')
      const raw = input.patch as Record<string, any>
      if (raw.hours && 'exemptions' in raw.hours || raw.tapd && ('workspaceIds' in raw.tapd || raw.tapd.writeAccess && 'workspaceIds' in raw.tapd.writeAccess)) throw new StorageError('INVALID_CONFIG')
      if (input.credential !== undefined) {
        newAccount = `tapd-${randomUUID()}`
        try { secretVault.put(newAccount, input.credential) } catch { throw new StorageError('KEYRING_WRITE_FAILED') }
      }
      db.transaction(() => {
        const latest = readSettings()
        if (latest.revision !== input.expectedRevision) throw new StorageError('REVISION_CONFLICT')
        const next = normalizeSettings({
          ...latest.settings, ...input.patch,
          hours: {...latest.settings.hours,...input.patch.hours},
          chinaCalendar: {...latest.settings.chinaCalendar,...input.patch.chinaCalendar},
          tapd: {...latest.settings.tapd,...input.patch.tapd,writeAccess:{...latest.settings.tapd.writeAccess,...input.patch.tapd?.writeAccess}},
          updatedAt: new Date().toISOString(),
        }).settings
        previousAccount = account()
        const changed = db.prepare('UPDATE settings SET revision=revision+1, value=?, updated_at=? WHERE id=1 AND revision=?').run(JSON.stringify(next), next.updatedAt, input.expectedRevision)
        if (changed.changes !== 1) throw new StorageError('REVISION_CONFLICT')
        db.prepare('UPDATE credentials SET account=? WHERE id=1').run(newAccount ?? previousAccount)
      }).immediate()
    } catch (error) {
      if (newAccount) { try { secretVault.remove(newAccount) } catch { /* committed reference was not changed */ } }
      if (error instanceof StorageError) throw error
      throw new StorageError('STORAGE_WRITE_FAILED')
    }
    if (newAccount && previousAccount) { try { secretVault.remove(previousAccount) } catch { /* committed credential remains valid */ } }
    return readSettings()
  }
  function getCache(key:string) {
    const item = db.prepare('SELECT fetched_at AS fetchedAt, status, value FROM tapd_cache WHERE cache_key=?').get(key) as {fetchedAt:string;status:string;value:string}|undefined
    return item ? {...item,value:JSON.parse(item.value) as unknown} : null
  }
  function putCache(key:string,fetchedAt:string,status:string,value:unknown) {
    db.prepare('INSERT INTO tapd_cache VALUES (?, ?, ?, ?) ON CONFLICT(cache_key) DO UPDATE SET fetched_at=excluded.fetched_at,status=excluded.status,value=excluded.value').run(key,fetchedAt,status,JSON.stringify(value))
  }
  return {db,readSettings,saveSettings,getCredential,clearCredential,getCache,putCache,close:()=>db.close()}
}
