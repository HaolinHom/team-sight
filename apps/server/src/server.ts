import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync, unlinkSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { McpServer } from '@modelcontextprotocol/server'
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node'
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server'
import { z } from 'zod'
import { openStore, configSchema, ProbeError } from './storage.js'
import { renderProbe } from './render.js'

export const UI_URI = 'ui://teamsight/p0-settings.html'
export const sentinelSchema = z.string().regex(/^TEAMSIGHT_P0_SENTINEL_[A-Za-z0-9_-]{1,80}$/)
const here = fileURLToPath(new URL('.', import.meta.url))
export const defaultUiPath = existsSync(resolve(here, '../ui/index.html'))
  ? resolve(here, '../ui/index.html') : resolve(here, '../../mcp-ui/dist/index.html')
const result = (value: Record<string, unknown>) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }], structuredContent: value })

export async function startServer(options: { dataDir: string; port: number; uiPath?: string }) {
  const dataDir = resolve(options.dataDir)
  mkdirSync(dataDir, { recursive: true, mode: 0o700 })
  const lockPath = join(dataDir, 'instance.lock')
  const instanceId = randomUUID()
  try { writeFileSync(lockPath, JSON.stringify({ pid: process.pid, instanceId }), { flag: 'wx', mode: 0o600 }) }
  catch { throw new ProbeError('INSTANCE_LOCKED: inspect instance.lock; do not terminate unknown processes') }
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
    if (!/^[a-f0-9]{64}$/.test(token)) throw new ProbeError('INVALID_ACCESS_TOKEN_FILE')
    const html = readFileSync(options.uiPath ?? defaultUiPath, 'utf8')
    store = openStore(dataDir)
    const shared = store
    const startedAt = new Date().toISOString()
    const status = () => ({ phase: 'P0', version: '0.0.0-p0', pid: process.pid, instanceId, startedAt, node: process.versions.node,
      napi: process.versions.napi, platform: process.platform, arch: process.arch,
      revision: shared.read().revision, credentialPresent: shared.read().credentialPresent,
      sessions: transports.size, tapdEnabled: false })
    function mcp() {
      const server = new McpServer({ name: 'TeamSight P0', version: '0.0.0-p0' }, {
        instructions: 'P0 isolated prototype. No TAPD calls. Use teamsight_probe_open_settings to test the MCP Apps configuration. Only test sentinel credentials are accepted. UI metadata is not a secrecy guarantee.',
      })
      server.registerTool('teamsight_status', { description: 'Read-only TeamSight P0 status; includes the shared process and instance identity.', inputSchema: z.object({}).strict(), annotations: { readOnlyHint: true, openWorldHint: false } }, () => result(status()))
      const ui = { resourceUri: UI_URI }
      const safely = (fn: () => Record<string, unknown>) => {
        try { return result(fn()) }
        catch (error) {
          const code = error instanceof ProbeError ? error.code : 'PROBE_FAILED'
          return { ...result({ code, current: shared.read() }), isError: true }
        }
      }
      registerAppTool(server, 'teamsight_probe_open_settings', { description: 'Open the P0 MCP Apps configuration prototype.', inputSchema: z.object({}).strict(), annotations: { readOnlyHint: true, openWorldHint: false }, _meta: { ui } }, () => result(shared.read()))
      registerAppTool(server, 'teamsight_probe_read_config', { description: 'Read the isolated prototype config and revision.', inputSchema: z.object({}).strict(), annotations: { readOnlyHint: true, openWorldHint: false }, _meta: { ui: { ...ui, visibility: ['app'] } } }, () => result(shared.read()))
      registerAppTool(server, 'teamsight_probe_save_config', {
        description: 'Save a prototype patch with optimistic revision checking. Test sentinel only; never submit a real TAPD credential.',
        inputSchema: z.object({ expectedRevision: z.number().int().min(0), patch: configSchema.partial(), testCredential: sentinelSchema.optional(), simulateFailure: z.boolean().optional() }).strict(),
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }, _meta: { ui: { ...ui, visibility: ['app'] } },
      }, args => safely(() => shared.save(args)))
      registerAppTool(server, 'teamsight_probe_check_credential', { description: 'Compare a test sentinel with the OS credential entry; return booleans only.', inputSchema: z.object({ expected: sentinelSchema }).strict(), annotations: { readOnlyHint: true, openWorldHint: false }, _meta: { ui: { ...ui, visibility: ['app'] } } }, args => safely(() => shared.verifyCredential(args.expected)))
      registerAppTool(server, 'teamsight_probe_clear_credential', { description: 'Remove this isolated prototype test credential.', inputSchema: z.object({}).strict(), annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false }, _meta: { ui: { ...ui, visibility: ['app'] } } }, () => safely(() => { shared.clearCredential(); return shared.read() }))
      server.registerTool('teamsight_probe_render', { description: 'Generate the P0 Chinese SVG/PNG sample. This is a rendering probe, not business data.', inputSchema: z.object({}).strict(), annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false } }, () => {
        const rendered = renderProbe(join(dataDir, 'artifacts'))
        return { ...result({ mimeType: 'image/png', sha256: rendered.sha256, width: 720, height: 180 }), content: [{ type: 'image' as const, mimeType: 'image/png', data: rendered.png.toString('base64') }] }
      })
      registerAppResource(server, 'TeamSight P0 settings', UI_URI, { description: 'Self-contained Vue configuration probe', _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] } } } }, () => ({ contents: [{ uri: UI_URI, mimeType: RESOURCE_MIME_TYPE, text: html, _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] } } } }] }))
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
      if (req.url === '/_p0/stop' && req.method === 'POST') {
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
      process.stderr.write('TeamSight P0: REQUEST_FAILED\n')
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
    if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') throw new ProbeError('PORT_IN_USE: choose another loopback port; no existing process was stopped')
    throw error
  }
}
