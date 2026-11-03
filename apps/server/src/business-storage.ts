import type Database from 'better-sqlite3'
import { randomUUID, createHash } from 'node:crypto'
import { mkdirSync, writeFileSync, renameSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export const fieldHashes = (fields: Record<string, unknown>): Record<string, string> => Object.fromEntries(Object.keys(fields).sort().map(key => {
  const value = String(fields[key] ?? '')
  // TAPD returns semicolon-terminated owner lists even for a single submitted account.
  const canonical = key === 'owner' ? value.split(';').map(item => item.trim()).filter(Boolean).sort().join(';')
    : key === 'effort' && value.trim() && Number.isFinite(Number(value)) ? String(Number(value)) : value
  return [key, digest(canonical)]
}))
export type OperationStatus = 'pending' | 'in_flight' | 'succeeded' | 'failed' | 'unknown'
export interface OperationReceipt {
  operationId: string
  idempotencyKey: string
  requestHash: string
  status: OperationStatus
  workspaceId: string
  entityType: 'story' | 'task'
  action: 'create' | 'update'
  actor: string
  expectedHashes: Record<string, string>
  remoteId?: string
  createdAt: string
  updatedAt: string
  code?: string
  httpStatus?: number
  businessStatus?: number
}
export interface FileRecord {
  id: string
  kind: 'snapshot' | 'analysis' | 'artifact'
  filename: string
  mimeType: string
  size: number
  sha256: string
  createdAt: string
  analysisId?: string
  snapshotId?: string
  resourceUri: string
}
export interface JobRecord { jobId: string; status: 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'; createdAt: string; analysisId?: string; code?: string }

export function businessStorage(db: Database.Database, dir: string) {
  const files = join(dir, 'files')
  mkdirSync(files, { recursive: true, mode: 0o700 })
  const getOperation = (id: string): OperationReceipt | null => {
    const row = db.prepare('SELECT value FROM operations WHERE operation_id=?').get(id) as { value: string } | undefined
    return row ? JSON.parse(row.value) : null
  }
  function updateOperation(id: string, patch: Partial<OperationReceipt>): OperationReceipt {
    const previous = getOperation(id)
    if (!previous) throw new Error('OPERATION_NOT_FOUND')
    const next = { ...previous, ...patch, operationId: id, updatedAt: new Date().toISOString() }
    db.prepare('UPDATE operations SET status=?, value=? WHERE operation_id=?').run(next.status, JSON.stringify(next), id)
    return next
  }
  // A process restart cannot prove that TAPD did not execute an emitted request.
  const unfinished = db.prepare("SELECT value FROM operations WHERE status IN ('in_flight','pending')").all() as { value: string }[]
  for (const { value } of unfinished) {
    const receipt = JSON.parse(value) as OperationReceipt
    updateOperation(receipt.operationId, { status: receipt.status === 'in_flight' ? 'unknown' : 'failed', code: 'SERVICE_INTERRUPTED' })
  }
  const getJob = (id: string): JobRecord | null => {
    const row = db.prepare('SELECT value FROM jobs WHERE id=?').get(id) as { value: string } | undefined
    return row ? JSON.parse(row.value) : null
  }
  const putJob = (job: JobRecord) => { db.prepare('INSERT INTO jobs VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET status=excluded.status, value=excluded.value').run(job.jobId, job.status, JSON.stringify(job)) }
  for (const row of db.prepare("SELECT value FROM jobs WHERE status='running'").all() as { value: string }[]) putJob({ ...JSON.parse(row.value), status: 'interrupted', code: 'SERVICE_INTERRUPTED' })
  function reserveOperation(input: Omit<OperationReceipt, 'operationId' | 'status' | 'createdAt' | 'updatedAt'>): { receipt: OperationReceipt; fresh: boolean } {
    return db.transaction(() => {
      const existing = db.prepare('SELECT value FROM operations WHERE idempotency_key=?').get(input.idempotencyKey) as { value: string } | undefined
      if (existing) {
        const receipt = JSON.parse(existing.value) as OperationReceipt
        if (receipt.requestHash !== input.requestHash) throw new Error('IDEMPOTENCY_KEY_CONFLICT')
        return { receipt, fresh: false }
      }
      const now = new Date().toISOString()
      const receipt: OperationReceipt = { ...input, operationId: randomUUID(), status: 'pending', createdAt: now, updatedAt: now }
      db.prepare('INSERT INTO operations VALUES (?, ?, ?, ?, ?)').run(receipt.operationId, receipt.idempotencyKey, receipt.requestHash, receipt.status, JSON.stringify(receipt))
      return { receipt, fresh: true }
    }).immediate()
  }
  function getFile(id: string): FileRecord {
    const row = db.prepare('SELECT value FROM documents WHERE id=?').get(id) as { value: string } | undefined
    if (!row) throw new Error('ARTIFACT_NOT_FOUND')
    return JSON.parse(row.value)
  }
  function readFile(id: string) { return readFileSync(join(files, getFile(id).filename)) }
  function putFile(kind: FileRecord['kind'], data: string | Buffer, extension: string, mimeType: string, refs: { analysisId?: string; snapshotId?: string } = {}, id: string = randomUUID()): FileRecord {
    if (!/^[a-z]+$/.test(extension) || !/^[a-f0-9-]{36}$/.test(id)) throw new Error('INVALID_ARTIFACT_ID')
    const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data)
    const filename = `${id}.${extension}`
    const temp = join(files, `${id}.${randomUUID()}.tmp`)
    writeFileSync(temp, bytes, { mode: 0o600, flag: 'wx' })
    renameSync(temp, join(files, filename))
    const record: FileRecord = { id, kind, filename, mimeType, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), createdAt: new Date().toISOString(), ...refs, resourceUri: `teamsight://artifacts/${id}` }
    db.prepare('INSERT INTO documents VALUES (?, ?, ?)').run(id, kind, JSON.stringify(record))
    return record
  }
  return { getOperation, reserveOperation, updateOperation, getFile, readFile, putFile, getJob, putJob,
    invalidateCache: () => { db.prepare('DELETE FROM tapd_cache').run() },
    getJson: <T>(id: string): T => JSON.parse(readFile(id).toString('utf8')) as T,
  }
}
export type BusinessStorage = ReturnType<typeof businessStorage>
