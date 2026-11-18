import { Resvg } from '@resvg/resvg-js'
import { createHash } from 'node:crypto'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

export function renderDiagnostic(dir: string) {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="720" height="180"><rect width="720" height="180" fill="#f7fafc"/><text x="28" y="60" font-family="PingFang SC,Microsoft YaHei,Noto Sans CJK SC,sans-serif" font-size="28" fill="#183153">团队排期 · 工时验证</text><rect x="28" y="90" width="420" height="32" rx="6" fill="#167d7f"/><text x="28" y="154" font-size="18" fill="#183153">TeamSight MCP · 8h</text></svg>'
  const renderer = new Resvg(svg, { font: { loadSystemFonts: true, defaultFontFamily: process.platform === 'win32' ? 'Microsoft YaHei' : 'PingFang SC' } })
  const png = renderer.render().asPng()
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'diagnostic.svg'), svg)
  writeFileSync(join(dir, 'diagnostic.png'), png)
  return { svg, png, sha256: createHash('sha256').update(png).digest('hex') }
}
