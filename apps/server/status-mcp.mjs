// Read-only helper for a host automation; never starts a second TeamSight instance.
import { readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
const dir = resolve(process.argv[2] ?? '.local/teamsight-p0')
const info = JSON.parse(readFileSync(join(dir, 'instance.json'), 'utf8'))
const token = readFileSync(join(dir, 'access-token'), 'utf8').trim()
const url = new URL(info.url)
if (url.hostname !== '127.0.0.1' || url.protocol !== 'http:') throw new Error('INVALID_INSTANCE_URL')
const client = new Client({ name: 'teamsight-p0-host-scheduler-probe', version: '1' })
const transport = new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${token}` } } })
try {
  await client.connect(transport)
  const value = await client.callTool({ name: 'teamsight_status', arguments: {} })
  if (value.isError || value.structuredContent?.instanceId !== info.instanceId) throw new Error('INSTANCE_ID_MISMATCH')
  console.log(JSON.stringify({ calledAt: new Date().toISOString(), tool: 'teamsight_status', ...value.structuredContent }))
} finally { await transport.terminateSession().catch(() => {}); await client.close() }
