import Database from 'better-sqlite3'
import { Entry } from '@napi-rs/keyring'
import { randomUUID } from 'node:crypto'
import { mkdirSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'

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
export function systemVault(service: string): Vault {
  return {
    put: (account, value) => new Entry(service, account).setPassword(value),
    get: account => new Entry(service, account).getPassword(),
    remove: account => { new Entry(service, account).deletePassword() },
  }
}

export function openStore(dir: string, vault?: Vault) {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const db = new Database(join(dir, 'probe.sqlite'))
  try {
    if (process.platform !== 'win32') chmodSync(join(dir, 'probe.sqlite'), 0o600)
    db.pragma('journal_mode = WAL')
    db.pragma('busy_timeout = 1000')
    db.transaction(() => {
      const version = db.pragma('user_version', { simple: true }) as number
      if (version > 1) throw new ProbeError('SCHEMA_TOO_NEW')
      db.exec('CREATE TABLE IF NOT EXISTS config (id INTEGER PRIMARY KEY CHECK (id=1), revision INTEGER NOT NULL, value TEXT NOT NULL, credential_account TEXT)')
      db.prepare('INSERT OR IGNORE INTO config VALUES (1, 0, ?, NULL)').run(JSON.stringify({ teamName: 'TeamSight P0', dailyHours: 8, timeZone: 'Asia/Shanghai' }))
      db.pragma('user_version = 1')
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
    db.prepare('UPDATE config SET credential_account=NULL, revision=revision+1 WHERE id=1 AND credential_account IS NOT NULL').run()
  }
  return { db, read, save, verifyCredential, clearCredential, close: () => db.close() }
}
