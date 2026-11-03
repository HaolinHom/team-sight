import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge'
const iframe = document.querySelector<HTMLIFrameElement>('#view')!
const bridge = new AppBridge(null, { name: 'TeamSight browser acceptance host', version: '1' }, { serverTools: {}, logging: {} })
bridge.oncalltool = async params => {
  const response = await fetch('/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) })
  if (!response.ok) throw new Error('PREVIEW_TOOL_REJECTED')
  return response.json()
}
bridge.oninitialized = async () => {
  const initial = await fetch(new URLSearchParams(location.search).get('page')==='settings'?'/initial?page=settings':'/initial').then(response => response.json())
  await bridge.sendToolInput({ arguments: { analysisId: initial.structuredContent.analysisId } })
  await bridge.sendToolResult(initial)
}
await bridge.connect(new PostMessageTransport(iframe.contentWindow!, iframe.contentWindow!))
iframe.src = new URLSearchParams(location.search).get('page')==='settings'?'/settings.html':'/analysis.html'
