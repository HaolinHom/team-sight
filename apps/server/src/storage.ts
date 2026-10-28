import Database from 'better-sqlite3'
import { Entry } from '@napi-rs/keyring'
import { randomUUID } from 'node:crypto'
import { mkdirSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { createDefaultSettings, importLegacySettings, normalizeSettings, type TeamSightSettings } from '@teamsight/core'

export const configSchema = z.object({
  teamName: z.string().trim().min(1).max(80),
  dailyHours: z.number().min(0).max(24),
  timeZone: z.enum(['Asia/Shanghai', 'UTC']),
}).strict()
export type ProbeConfig = z.infer<typeof configSchema>
export class ProbeError extends Error {
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
  importedFrom?: string
  warning?: string
}

export interface TeamSightStore {
  db: Database.Database
  read(): { revision: number; config: ProbeConfig; credentialPresent: boolean }
  save(input: { expectedRevision: number; patch: Partial<ProbeConfig>; testCredential?: string; simulateFailure?: boolean }): { revision: number; config: ProbeConfig; credentialPresent: boolean }
  verifyCredential(expected: string): { present: boolean; matches: boolean }
  clearCredential(): void
  getCredential(): string | null
  readSettings(): SettingsSnapshot
  saveSettings(input: { expectedRevision: number; patch: Partial<TeamSightSettings>; credential?: string }): SettingsSnapshot
  importSettings(input: { expectedRevision: number; raw: unknown; source: string }): SettingsSnapshot & { ignoredCredential: boolean }
  getCache(key: string): { fetchedAt: string; status: string; value: unknown } | null
  putCache(key: string, fetchedAt: string, status: string, value: unknown): void
  close(): void
}
export function systemVault(service: string): Vault {
  return {
    put: (account, value) => new Entry(service, account).setPassword(value),
    get: account => new Entry(service, account).getPassword(),
    remove: account => { new Entry(service, account).deletePassword() },
  }
}

export function openStore(dir: string, vault?: Vault): TeamSightStore {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const db = new Database(join(dir, 'probe.sqlite'))
  try {
    if (process.platform !== 'win32') chmodSync(join(dir, 'probe.sqlite'), 0o600)
    db.pragma('journal_mode = WAL')
    db.pragma('busy_timeout = 1000')
    db.transaction(() => {
      const version = db.pragma('user_version', { simple: true }) as number
      if (version > 2) throw new ProbeError('SCHEMA_TOO_NEW')
      db.exec('CREATE TABLE IF NOT EXISTS config (id INTEGER PRIMARY KEY CHECK (id=1), revision INTEGER NOT NULL, value TEXT NOT NULL, credential_account TEXT)')
      db.prepare('INSERT OR IGNORE INTO config VALUES (1, 0, ?, NULL)').run(JSON.stringify({ teamName: 'TeamSight P0', dailyHours: 8, timeZone: 'Asia/Shanghai' }))
      db.exec('CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK (id=1), revision INTEGER NOT NULL, value TEXT NOT NULL, imported_from TEXT, updated_at TEXT NOT NULL)')
      db.exec('CREATE TABLE IF NOT EXISTS tapd_cache (cache_key TEXT PRIMARY KEY, fetched_at TEXT NOT NULL, status TEXT NOT NULL, value TEXT NOT NULL)')
      const existing = db.prepare('SELECT revision, value FROM config WHERE id=1').get() as { revision: number; value: string }
      const existingSettings = db.prepare('SELECT id FROM settings WHERE id=1').get()
      if (!existingSettings) {
        const probe = JSON.parse(existing.value) as Partial<ProbeConfig>
        const migrated = normalizeSettings({
          ...createDefaultSettings(),
          teamName: probe.teamName,
          hours: { dailyRequiredHours: probe.dailyHours },
          timeZone: probe.timeZone,
        }).settings
        db.prepare('INSERT INTO settings (id, revision, value, imported_from, updated_at) VALUES (1, ?, ?, NULL, ?)').run(existing.revision, JSON.stringify(migrated), migrated.updatedAt)
      }
      db.pragma('user_version = 2')
    })()
  } catch (error) { db.close(); throw error }
  // Credential accounts use UUIDs, so isolated data directories never share entries.
  const secretVault = vault ?? systemVault('TeamSight.P0')
  function row() {
    return db.prepare('SELECT revision, value, credential_account AS account FROM config WHERE id=1').get() as { revision: number; value: string; account: string | null }
  }
  function read() {
    const r = row()
    return { revision: r.revision, config: JSON.parse(r.value) as ProbeConfig, credentialPresent: !!r.account }
  }
  function mirrorSettings(next: TeamSightSettings, revision: number, importedFrom: string | null = null) {
    db.prepare('UPDATE settings SET revision=?, value=?, imported_from=?, updated_at=? WHERE id=1').run(revision, JSON.stringify(next), importedFrom, next.updatedAt)
  }

  function readSettings(): SettingsSnapshot {
    const settingsRow = db.prepare('SELECT revision, value, imported_from AS importedFrom FROM settings WHERE id=1').get() as { revision: number; value: string; importedFrom: string | null }
    const normalized = normalizeSettings(JSON.parse(settingsRow.value))
    return { revision: settingsRow.revision, settings: normalized.settings, credentialPresent: !!row().account, importedFrom: settingsRow.importedFrom ?? undefined, warning: normalized.warning }
  }

  function save(input: { expectedRevision: number; patch: Partial<ProbeConfig>; testCredential?: string; simulateFailure?: boolean }) {
    let newAccount: string | undefined
    let previousAccount: string | null = null
    try {
      // Stage a new credential before the short DB transaction; never put a secret in SQLite.
      if (row().revision !== input.expectedRevision) throw new ProbeError('REVISION_CONFLICT')
      if (input.testCredential !== undefined) {
        newAccount = `probe-${randomUUID()}`
        try { secretVault.put(newAccount, input.testCredential) }
        catch { throw new ProbeError('KEYRING_WRITE_FAILED') }
      }
      db.transaction(() => {
        const r = row()
        if (r.revision !== input.expectedRevision) throw new ProbeError('REVISION_CONFLICT')
        const value = configSchema.parse({ ...JSON.parse(r.value), ...input.patch })
        previousAccount = r.account
        db.prepare('UPDATE config SET revision=revision+1, value=?, credential_account=? WHERE id=1')
          .run(JSON.stringify(value), newAccount ?? r.account)
        const settings = readSettings().settings
        mirrorSettings(normalizeSettings({ ...settings, teamName: value.teamName, timeZone: value.timeZone, hours: { ...settings.hours, dailyRequiredHours: value.dailyHours }, updatedAt: new Date().toISOString() }).settings, input.expectedRevision + 1)
        if (input.simulateFailure) throw new ProbeError('SAVE_FAILED')
      }).immediate()
    } catch (error) {
      if (newAccount) { try { secretVault.remove(newAccount) } catch { /* test credential cleanup can be retried */ } }
      if (error instanceof ProbeError) throw error
      if (error instanceof z.ZodError) throw new ProbeError('INVALID_CONFIG')
      throw new ProbeError('STORAGE_WRITE_FAILED')
    }
    if (newAccount && previousAccount) { try { secretVault.remove(previousAccount) } catch { /* committed config remains valid */ } }
    return read()
  }
  function verifyCredential(expected: string) {
    const account = row().account
    try { return { present: !!account, matches: account ? secretVault.get(account) === expected : false } }
    catch { throw new ProbeError('KEYRING_READ_FAILED') }
  }
  function clearCredential() {
    const account = row().account
    if (account) secretVault.remove(account)
    db.transaction(() => {
      const current = row()
      if (!current.account) return
      db.prepare('UPDATE config SET credential_account=NULL, revision=revision+1 WHERE id=1').run()
      const settings = readSettings().settings
      mirrorSettings({ ...settings, updatedAt: new Date().toISOString() }, current.revision + 1)
    })()
  }

  function getCredential() {
    const account = row().account
    if (!account) return null
    try { return secretVault.get(account) } catch { throw new ProbeError('KEYRING_READ_FAILED') }
  }

  function saveSettings(input: { expectedRevision: number; patch: Partial<TeamSightSettings>; credential?: string }): SettingsSnapshot {
    let newAccount: string | undefined
    let previousAccount: string | null = null
    try {
      const current = readSettings()
      if (current.revision !== input.expectedRevision) throw new ProbeError('REVISION_CONFLICT')
      if (input.credential !== undefined) {
        newAccount = `tapd-${randomUUID()}`
        try { secretVault.put(newAccount, input.credential) } catch { throw new ProbeError('KEYRING_WRITE_FAILED') }
      }
      db.transaction(() => {
        const latest = readSettings()
        if (latest.revision !== input.expectedRevision) throw new ProbeError('REVISION_CONFLICT')
        const next = normalizeSettings({ ...latest.settings, ...input.patch, hours: input.patch.hours ?? latest.settings.hours, tapd: input.patch.tapd ?? latest.settings.tapd, updatedAt: new Date().toISOString() }).settings
        previousAccount = row().account
        db.prepare('UPDATE settings SET revision=revision+1, value=?, imported_from=NULL, updated_at=? WHERE id=1').run(JSON.stringify(next), next.updatedAt)
        const probe = { teamName: next.teamName, dailyHours: next.hours.dailyRequiredHours, timeZone: next.timeZone }
        db.prepare('UPDATE config SET revision=revision+1, value=?, credential_account=? WHERE id=1').run(JSON.stringify(probe), newAccount ?? previousAccount)
      })()
    } catch (error) {
      if (newAccount) { try { secretVault.remove(newAccount) } catch { /* cleanup can be retried */ } }
      if (error instanceof ProbeError) throw error
      throw new ProbeError('STORAGE_WRITE_FAILED')
    }
    if (newAccount && previousAccount) { try { secretVault.remove(previousAccount) } catch { /* committed value remains valid */ } }
    return readSettings()
  }

  function importSettings(input: { expectedRevision: number; raw: unknown; source: string }) {
    const current = readSettings()
    if (current.revision !== input.expectedRevision) throw new ProbeError('REVISION_CONFLICT')
    const imported = importLegacySettings(input.raw)
    const next = imported.settings
    db.transaction(() => {
      const latest = readSettings()
      if (latest.revision !== input.expectedRevision) throw new ProbeError('REVISION_CONFLICT')
      db.prepare('UPDATE settings SET revision=revision+1, value=?, imported_from=?, updated_at=? WHERE id=1').run(JSON.stringify(next), input.source, next.updatedAt)
      db.prepare('UPDATE config SET revision=revision+1, value=? WHERE id=1').run(JSON.stringify({ teamName: next.teamName, dailyHours: next.hours.dailyRequiredHours, timeZone: next.timeZone }))
    })()
    return { ...readSettings(), ignoredCredential: imported.ignoredCredential }
  }

  function getCache(key: string) {
    const item = db.prepare('SELECT fetched_at AS fetchedAt, status, value FROM tapd_cache WHERE cache_key=?').get(key) as { fetchedAt: string; status: string; value: string } | undefined
    return item ? { fetchedAt: item.fetchedAt, status: item.status, value: JSON.parse(item.value) as unknown } : null
  }

  function putCache(key: string, fetchedAt: string, status: string, value: unknown) {
    db.prepare('INSERT INTO tapd_cache (cache_key, fetched_at, status, value) VALUES (?, ?, ?, ?) ON CONFLICT(cache_key) DO UPDATE SET fetched_at=excluded.fetched_at, status=excluded.status, value=excluded.value').run(key, fetchedAt, status, JSON.stringify(value))
  }

  return { db, read, save, verifyCredential, clearCredential, getCredential, readSettings, saveSettings, importSettings, getCache, putCache, close: () => db.close() }
}
