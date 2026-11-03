/** Local, read-only test host. Not built or shipped with the product. */
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { build } from '../../mcp-ui/node_modules/vite/dist/node/index.js'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
const root = resolve(new URL('../../..', import.meta.url).pathname)
const dataDir = join(root, '.local/teamsight-p1b-live'), output = '/tmp/teamsight-p1b-preview'
await build({ root: join(root, 'apps/mcp-ui/test'), configFile: false, build: { target: 'esnext', outDir: output, emptyOutDir: true, rollupOptions: { input: join(root, 'apps/mcp-ui/test/host.html') } } })
const info = JSON.parse(readFileSync(join(dataDir, 'instance.json'), 'utf8'))
const token = readFileSync(join(dataDir, 'access-token'), 'utf8').trim()
const analysisId = JSON.parse(readFileSync(join(root, 'artifacts/report/20261028_teamsight-p1b_evidence/live-acceptance.json'), 'utf8')).analysis.analysisId
const client = new Client({ name: 'p1b-browser-host', version: '1' })
const transport = new StreamableHTTPClientTransport(new URL(info.url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } })
await client.connect(transport)
const allowed = new Set(['teamsight_get_config', 'teamsight_open_analysis', 'teamsight_read_analysis', 'teamsight_analyze_hours', 'teamsight_get_job', 'teamsight_cancel_job', 'teamsight_render_gantt', 'teamsight_generate_report', 'teamsight_read_artifact', 'teamsight_open_settings'])
const server = createServer(async (req, res) => {
  try {
    if (req.headers.host !== '127.0.0.1:43130') { res.writeHead(403); res.end(); return }
    if (req.url === '/rpc' && req.method === 'POST') {
      if (req.headers.origin !== 'http://127.0.0.1:43130') throw new Error('ORIGIN')
      let body = ''
      for await (const chunk of req) { body += chunk; if (body.length > 64000) throw new Error('SIZE') }
      const input = JSON.parse(body)
      if (!allowed.has(input.name)) throw new Error('TOOL')
      const result = await client.callTool(input)
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(result)); return
    }
    if (req.url === '/initial') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(await client.callTool({ name: 'teamsight_open_analysis', arguments: { analysisId } }))); return
    }
    const path = req.url === '/' ? join(output, 'host.html') : req.url === '/analysis.html' ? join(root, 'apps/mcp-ui/dist/analysis.html') : /^\/assets\/[\w.-]+\.js$/.test(req.url) ? join(output, req.url) : null
    if (!path) { res.writeHead(404); res.end(); return }
    res.writeHead(200, { 'Content-Type': path.endsWith('.js') ? 'application/javascript' : 'text/html', 'Cache-Control': 'no-store' }); res.end(readFileSync(path))
  } catch { res.writeHead(400); res.end('PREVIEW_REJECTED') }
})
server.listen(43130, '127.0.0.1', () => console.log('P1B_PREVIEW_READY http://127.0.0.1:43130'))
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await client.close(); server.close() })
