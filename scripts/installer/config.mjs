import { parseForESLint, getStaticTOMLValue } from 'toml-eslint-parser'
import { isDeepStrictEqual } from 'node:util'

const names = key => key.keys.map(part => part.type === 'TOMLBare' ? part.name : part.value)
const same = isDeepStrictEqual
const prefix = (a, b) => a.length <= b.length && a.every((x, i) => x === b[i])
const quoted = path => path.map(JSON.stringify).join('.')
export function parseConfig(text) {
  try { return getStaticTOMLValue(parseForESLint(text).ast) }
  catch { throw new Error('CODEX_CONFIG_INVALID') }
}
function index(text) {
  let ast
  try { ast = parseForESLint(text).ast } catch { throw new Error('CODEX_CONFIG_INVALID') }
  const entries = [], tables = []
  function visit(list, base, inline = null) {
    for (const node of list) {
      if (node.type === 'TOMLTable') { tables.push(node); visit(node.body, node.resolvedKey); continue }
      if (node.type !== 'TOMLKeyValue') continue
      const path = [...base, ...names(node.key)]
      entries.push({ node, path, inline, siblings: list })
      if (node.value.type === 'TOMLInlineTable') visit(node.value.body, path, node.value)
    }
  }
  visit(ast.body[0].body, [])
  return { entries, tables }
}
function removeEntry(text, entry) {
  let [start, end] = entry.node.range
  if (entry.inline) {
    const i = entry.siblings.indexOf(entry.node)
    if (i < entry.siblings.length - 1) end = entry.siblings[i + 1].range[0]
    else if (i > 0) start = entry.siblings[i - 1].range[1]
  }
  return text.slice(0, start) + text.slice(end)
}
export function deleteConfigPath(text, path) {
  const { entries, tables } = index(text)
  const exact = entries.find(e => same(e.path, path))
  if (exact) return removeEntry(text, exact)
  // Delete one range at a time and reparse, so inline commas and offsets stay valid.
  const table = tables.find(t => prefix(path, t.resolvedKey))
  if (table) return deleteConfigPath(text.slice(0, table.range[0]) + text.slice(table.range[1]), path)
  const child = entries.find(e => prefix(path, e.path))
  return child ? deleteConfigPath(removeEntry(text, child), path) : text
}
function setConfigPath(text, path, value) {
  const { entries, tables } = index(text), encoded = JSON.stringify(value)
  const exact = entries.find(e => same(e.path, path))
  if (exact) { const [a, b] = exact.node.value.range; return text.slice(0, a) + encoded + text.slice(b) }
  const inline = entries.filter(e => prefix(e.path, path) && e.node.value.type === 'TOMLInlineTable').sort((a, b) => b.path.length - a.path.length)[0]
  if (inline) {
    const at = inline.node.value.range[1] - 1
    return text.slice(0, at) + (inline.node.value.body.length ? ', ' : '') + quoted(path.slice(inline.path.length)) + ' = ' + encoded + text.slice(at)
  }
  const table = tables.filter(t => t.kind === 'standard' && prefix(t.resolvedKey, path)).sort((a, b) => b.resolvedKey.length - a.resolvedKey.length)[0]
  if (table) { const at = table.range[1]; return text.slice(0, at) + '\n' + quoted(path.slice(table.resolvedKey.length)) + ' = ' + encoded + '\n' + text.slice(at) }
  // Root dotted keys also handle implicit parents created by later nested tables.
  return quoted(path) + ' = ' + encoded + '\n' + text
}
export function configureCodex(text, url, token) {
  const before = parseConfig(text), target = ['mcp_servers', 'teamsight']
  if (before.mcp_servers !== undefined && (!before.mcp_servers || typeof before.mcp_servers !== 'object' || Array.isArray(before.mcp_servers))) throw new Error('CODEX_CONFIG_INVALID')
  const previous = before.mcp_servers?.teamsight
  if (previous !== undefined && (!previous || typeof previous !== 'object' || Array.isArray(previous))) throw new Error('CODEX_CONFIG_INVALID')
  for (const key of ['command', 'args', 'env', 'env_vars', 'cwd', 'type', 'bearer_token_env_var', 'http_headers_helper', 'auth', 'oauth']) text = deleteConfigPath(text, [...target, key])
  for (const field of ['http_headers', 'env_http_headers']) {
    const headers = parseConfig(text).mcp_servers?.teamsight?.[field]
    if (headers !== undefined && (!headers || typeof headers !== 'object' || Array.isArray(headers))) throw new Error('CODEX_CONFIG_INVALID')
    for (const key of Object.keys(headers ?? {})) if (key.toLowerCase() === 'authorization') text = deleteConfigPath(text, [...target, field, key])
  }
  text = setConfigPath(text, [...target, 'url'], url)
  text = setConfigPath(text, [...target, 'enabled'], true)
  text = setConfigPath(text, [...target, 'http_headers', 'Authorization'], 'Bearer ' + token)
  const after = parseConfig(text)
  const without = obj => { const copy = structuredClone(obj); if (copy.mcp_servers) { delete copy.mcp_servers.teamsight; if (!Object.keys(copy.mcp_servers).length) delete copy.mcp_servers } return copy }
  if (!same(without(before), without(after))) throw new Error('CODEX_CONFIG_UNRELATED_CHANGE')
  return text
}
