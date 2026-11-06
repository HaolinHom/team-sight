import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync, unlinkSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { McpServer } from '@modelcontextprotocol/server'
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node'
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server'
import { z } from 'zod'
import { openStore, StorageError } from './storage.js'
import { type TapdTransport } from '@teamsight/tapd'
import { createBusiness } from './business.js'
import { registerBusinessTools } from './business-tools.js'
import { createScenarios } from './scenarios.js'
import { registerScenarioTools } from './scenario-tools.js'
import type { Vault } from './storage.js'
import { type TeamSightSettings } from '@teamsight/core'

export const SETTINGS_UI_URI = 'ui://teamsight/settings-0.3.0.html'
const here = fileURLToPath(new URL('.', import.meta.url))
export const defaultSettingsUiPath = existsSync(resolve(here, '../ui/settings.html'))
  ? resolve(here, '../ui/settings.html') : resolve(here, '../../mcp-ui/dist/settings.html')
export const defaultAnalysisUiPath = existsSync(resolve(here, '../ui/analysis.html'))
  ? resolve(here, '../ui/analysis.html') : resolve(here, '../../mcp-ui/dist/analysis.html')
const result = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }], structuredContent: value })

export async function startServer(options: { dataDir: string; port: number; settingsUiPath?: string; analysisUiPath?: string; vault?: Vault; tapdTransport?: TapdTransport }) {
  const dataDir = resolve(options.dataDir)
  mkdirSync(dataDir, { recursive: true, mode: 0o700 })
  if(existsSync(join(dataDir,'.migration'))) throw new StorageError('MIGRATION_IN_PROGRESS')
  const lockPath = join(dataDir, 'instance.lock')
  const instanceId = randomUUID()
  try { writeFileSync(lockPath, JSON.stringify({ pid: process.pid, instanceId }), { flag: 'wx', mode: 0o600 }) }
  catch { throw new StorageError('INSTANCE_LOCKED: inspect instance.lock; do not terminate unknown processes') }
  let store: ReturnType<typeof openStore> | undefined
  const transports = new Map<string, NodeStreamableHTTPServerTransport>()
  let closing = false
  const infoPath = join(dataDir, 'instance.json')
  let listener: ReturnType<typeof createServer> | undefined
  const release = () => {
    if (existsSync(infoPath)) unlinkSync(infoPath)
    if (existsSync(lockPath)) unlinkSync(lockPath)
  }
  try {
    const tokenPath = join(dataDir, 'access-token')
    if (!existsSync(tokenPath)) writeFileSync(tokenPath, randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' })
    const token = readFileSync(tokenPath, 'utf8').trim()
    if (!/^[a-f0-9]{64}$/.test(token)) throw new StorageError('INVALID_ACCESS_TOKEN_FILE')
    const settingsHtml = readFileSync(options.settingsUiPath ?? defaultSettingsUiPath, 'utf8')
    store = openStore(dataDir, options.vault)
    const shared = store
    const business = createBusiness(shared, dataDir, options.tapdTransport)
    const scenarios = createScenarios(business, shared)
    const analysisHtml = readFileSync(options.analysisUiPath ?? defaultAnalysisUiPath, 'utf8')
    const startedAt = new Date().toISOString()
    const status = () => ({ phase: 'MCP', version: '0.3.0', pid: process.pid, instanceId, startedAt, node: process.versions.node,
      napi: process.versions.napi, platform: process.platform, arch: process.arch,
      revision: shared.readSettings().revision, credentialPresent: shared.readSettings().credentialPresent,
      settingsRevision: shared.readSettings().revision, sessions: transports.size, tapdEnabled: true })
    function mcp() {
      const server = new McpServer({ name: 'TeamSight', version: '0.3.0' }, {
        instructions: 'When CONFIG_REQUIRED, immediately call teamsight_open_settings with target connection and continueRead true when credentials are missing; for a missing team or project scope open the relevant configuration target. After Apps reports configuration completion, continue the original read request; never request a token in chat. Use currentUser for self and default owners. Team defaults use exactly the default group, not every cached identity. Use context and scheduling tools for scenario data; urgent tools only simulate. Dependencies are rebuilt from TAPD and current conversation. TeamSight provides TAPD story/task writes, immutable hours/schedule/risk analyses, Apps charts and file reports. Enabled accessible projects define default query and write scopes; configure allowed write operations and fields in connection settings. Reuse idempotency keys and verify unknown writes; do not retry mutations automatically. Open only the requested settings target; do not show unrelated configuration. Gantt cards only offer task/hour mode switching; determine people, project and dates in conversation. Analyze first then open the analysisId; exports, risk interpretation and simulation candidate comparisons are requested in conversation. Use one analysisId for related outputs. Incomplete data is not zero. Credentials are never returned by tools.',
      })
      server.registerTool('teamsight_status', { description: 'Read-only TeamSight service status; includes the shared process and instance identity.', inputSchema: z.object({}).strict(), annotations: { readOnlyHint: true, openWorldHint: false } }, () => result(status()))
      const settingsUi = { resourceUri: SETTINGS_UI_URI }
      const settingsPatchSchema = z.object({
        teamName: z.string().trim().min(1).max(80).optional(),
        timeZone: z.enum(['Asia/Shanghai', 'UTC']).optional(),
        projects: z.array(z.unknown()).optional(),
        members: z.array(z.unknown()).optional(),
        groups: z.array(z.unknown()).optional(),
        defaultGroupId: z.string().optional(),
        hours: z.unknown().optional(),
        chinaCalendar: z.unknown().optional(),
        tapd: z.unknown().optional(),
      }).strict()
      const settingsResult = (value: unknown) => result(value)
      const settingsSafely = async (fn: () => unknown) => {
        try { return settingsResult(await fn()) }
        catch (error) {
          const code = error instanceof StorageError ? error.code : 'SETTINGS_FAILED'
          return { ...settingsResult({ code, current: shared.readSettings() }), isError: true }
        }
      }
      registerAppTool(server, 'teamsight_open_settings', {
        description: 'Open only the requested settings target. Omit target for the category chooser; use connection for credentials, query types and write operations/fields; projects, members, groups, hours, calendar or completed for the other settings. Set continueRead when configuration blocked a read request.',
        inputSchema: z.object({ target: z.enum(['overview','connection','projects','members','groups','hours','calendar','completed']).optional(), continueRead: z.boolean().optional() }).strict(),
        annotations: { readOnlyHint: true, openWorldHint: false }, _meta: { ui: settingsUi },
      }, args => { const snapshot = shared.readSettings(); return settingsResult({ ...snapshot, target: args.target ?? (snapshot.credentialPresent ? 'overview' : 'connection'), continueRead: args.continueRead ?? false }) })
      registerAppTool(server, 'teamsight_read_settings', { description: 'Read current TeamSight settings and revision. Secrets are represented only by credentialPresent.', inputSchema: z.object({}).strict(), annotations: { readOnlyHint: true, openWorldHint: false }, _meta: { ui: { ...settingsUi, visibility: ['app'] } } }, () => settingsResult(shared.readSettings()))
      registerAppTool(server, 'teamsight_save_settings', {
        description: 'Save a validated settings patch using an expected revision. A TAPD token, when supplied by the Apps UI, is stored in the OS credential vault and never returned.',
        inputSchema: z.object({ expectedRevision: z.number().int().min(0), patch: settingsPatchSchema, tapdToken: z.string().min(1).optional() }).strict(),
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }, _meta: { ui: { ...settingsUi, visibility: ['app'] } },
      }, args => settingsSafely(async () => {
        const saved = shared.saveSettings({ expectedRevision: args.expectedRevision, patch: args.patch as Partial<TeamSightSettings>, credential: args.tapdToken })
        if (!args.tapdToken) return saved
        try { return await scenarios.syncProjects() } catch { return { ...shared.readSettings(), bootstrap: { status: 'partial', code: 'BOOTSTRAP_FAILED', next: 'teamsight_sync_projects' } } }
      }))
      registerBusinessTools(server, business, shared, analysisHtml, scenarios)
      registerScenarioTools(server, scenarios)
      for (const uri of [SETTINGS_UI_URI]) registerAppResource(server, 'TeamSight settings '+uri, uri, { description: 'Self-contained focused settings card', _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] } } } }, () => ({ contents: [{ uri, mimeType: RESOURCE_MIME_TYPE, text: settingsHtml, _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] } } } }] }))
      return server
    }
    const answer = (res: ServerResponse, code: number, value: unknown) => {
      res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
      res.end(JSON.stringify(value))
    }
    let actualPort = options.port
    async function handle(req: IncomingMessage, res: ServerResponse) {
      const hosts = [`127.0.0.1:${actualPort}`, `localhost:${actualPort}`]
      if (!hosts.includes(req.headers.host ?? '')) return answer(res, 403, { code: 'HOST_REJECTED' })
      const origin = req.headers.origin
      if (origin !== undefined && !hosts.map(h => `http://${h}`).includes(origin)) return answer(res, 403, { code: 'ORIGIN_REJECTED' })
      const expected = Buffer.from(`Bearer ${token}`)
      const auth = Buffer.from(req.headers.authorization ?? '')
      if (auth.length !== expected.length || !timingSafeEqual(auth, expected)) return answer(res, 401, { code: 'UNAUTHORIZED' })
      if (closing) return answer(res, 503, { code: 'SHUTTING_DOWN' })
      if (req.url === '/health' && req.method === 'GET') return answer(res, 200, status())
      if (req.url === '/_internal/stop' && req.method === 'POST') {
        answer(res, 200, { instanceId, stopping: true })
        setImmediate(() => { void close() })
        return
      }
      if (req.url !== '/mcp') return answer(res, 404, { code: 'NOT_FOUND' })
      const sessionId = req.headers['mcp-session-id']
      let transport = typeof sessionId === 'string' ? transports.get(sessionId) : undefined
      let body: unknown
      if (req.method === 'POST') {
        let size = 0
        const chunks: Buffer[] = []
        for await (const chunk of req) {
          size += Buffer.byteLength(chunk)
          if (size > 64 * 1024) return answer(res, 413, { code: 'BODY_TOO_LARGE' })
          chunks.push(Buffer.from(chunk))
        }
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) }
        catch { return answer(res, 400, { code: 'INVALID_JSON' }) }
      }
      if (!transport) {
        if (sessionId) return answer(res, 404, { code: 'SESSION_NOT_FOUND' })
        if (req.method !== 'POST' || (body as { method?: string })?.method !== 'initialize') return answer(res, 400, { code: 'INITIALIZE_REQUIRED' })
        if (transports.size >= 64) return answer(res, 503, { code: 'SESSION_LIMIT' })
        transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: randomUUID, enableJsonResponse: true,
          onsessioninitialized: id => { transports.set(id, transport!) } })
        await mcp().connect(transport)
        const previousClose = transport.onclose
        const currentTransport = transport
        transport.onclose = () => { previousClose?.(); if (currentTransport.sessionId) transports.delete(currentTransport.sessionId) }
      }
      await transport.handleRequest(req, res, body)
      if (!transport.sessionId) await transport.close()
    }
    listener = createServer((req, res) => { void handle(req, res).catch(() => {
      // Never log request bodies, authorization, keyring errors or config patches.
      process.stderr.write('TeamSight: REQUEST_FAILED\n')
      if (!res.headersSent) answer(res, 500, { code: 'REQUEST_FAILED' })
      else res.end()
    }) })
    listener.requestTimeout = 15_000
    listener.headersTimeout = 10_000
    await new Promise<void>((ok, fail) => { listener!.once('error', fail); listener!.listen(options.port, '127.0.0.1', () => { listener!.removeListener('error', fail); ok() }) })
    actualPort = (listener.address() as { port: number }).port
    const info = { ...status(), url: `http://127.0.0.1:${actualPort}/mcp`, dataDir, tokenFile: tokenPath }
    writeFileSync(infoPath, JSON.stringify(info, null, 2), { mode: 0o600 })
    async function close() {
      if (closing) return
      closing = true
      await Promise.allSettled([...transports.values()].map(t => t.close()))
      await new Promise<void>(ok => listener!.close(() => ok()))
      await business.close()
      shared.close()
      release()
      process.removeListener('SIGINT', onSignal)
      process.removeListener('SIGTERM', onSignal)
    }
    const onSignal = () => { void close() }
    process.on('SIGINT', onSignal)
    process.on('SIGTERM', onSignal)
    return { info, close }
  } catch (error) {
    listener?.close()
    store?.close()
    release()
    if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') throw new StorageError('PORT_IN_USE: choose another loopback port; no existing process was stopped')
    throw error
  }
}
