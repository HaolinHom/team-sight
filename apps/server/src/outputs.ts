import { Resvg } from '@resvg/resvg-js'
import { computeLayout, eachDateKey, buildGanttDisplayTasks, filterGanttDisplayTasks, ganttDisplayRows, dateDiffInDays, type TeamAnalysis } from '@teamsight/core'
import type { BusinessStorage, FileRecord } from './business-storage.js'

export const escapeHtml = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
export const csvCell = (value: unknown): string => {
  const text = String(value ?? '')
  return `"${(/^[\s\u0000-\u001f]*[=+\-@]/.test(text) ? "'" + text : text).replace(/"/g, '""')}"`
}
const md = (value: unknown) => escapeHtml(value).replace(/[\\`*_[\]{}|]/g, '\\$&').replace(/[\r\n]+/g, ' ')
const short = (value: string, limit = 22) => Array.from(value).length > limit ? Array.from(value).slice(0, limit - 1).join('') + '…' : value
const n = (value: number) => Math.floor((value + 1e-9) * 100) / 100

export function ganttSvgs(analysis: TeamAnalysis): string[] {
  const pages: string[] = []
  const dates = eachDateKey(analysis.context.range)
  const tasks = buildGanttDisplayTasks(analysis.snapshot.tasks, analysis.members, analysis.context.range, analysis.contributionItems)
  const memberNames = new Map(analysis.members.map(member => [`staff:${member.member.staffId}`, member.member.name]))
  for (let dateIndex = 0; dateIndex < dates.length; dateIndex += 30) {
    const range = { start: dates[dateIndex], end: dates[Math.min(dateIndex + 29, dates.length - 1)] }
    const displayRows = ganttDisplayRows(filterGanttDisplayTasks(tasks, range, analysis.context.memberIds))
    const byId = new Map(displayRows.map(row => [row.layoutTask.sourceType + ':' + row.layoutTask.id, row]))
    // Sort the complete member/date list before splitting pages, using the same layout as the UI.
    const ordered = computeLayout({ tasks: displayRows.map(row => row.layoutTask), range, memberNames,
      memberOrder: analysis.context.memberIds.map(id => 'staff:' + id), memberKeysOf: task => task.assigneeIds.map(id => 'staff:' + id) })
    const pairs = ordered.rows.flatMap(row => row.type === 'task' ? [byId.get(row.taskId)!] : [])
    for (let offset = 0; offset < Math.max(pairs.length, 1); offset += 30) {
      if (pages.length >= 200) throw new Error('OUTPUT_PAGE_BUDGET_EXCEEDED')
      const group = pairs.slice(offset, offset + 30)
      const chunk = group.map(pair => pair.layoutTask)
      const sources = new Map(group.map(pair => [pair.layoutTask.sourceType + ':' + pair.layoutTask.id, pair]))
      const layout = computeLayout({ tasks: chunk, range, today: analysis.context.analysisDate, memberNames,
        memberOrder: analysis.context.memberIds.map(id => 'staff:' + id),
        memberKeysOf: task => task.assigneeIds.map(id => 'staff:' + id) })
      const width = layout.totalWidth + layout.config.labelColumnWidth + 32
      const height = Math.max(layout.totalHeight, 44) + 144
      if (width * height > 16_000_000) throw new Error('GANTT_PAGE_TOO_LARGE')
      const labelWidth = layout.config.labelColumnWidth, top = 96
      const pieces = [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#ffffff"/><g font-family="PingFang SC,Microsoft YaHei,Noto Sans CJK SC,sans-serif" font-size="13" fill="#243447">`,
        `<text x="16" y="28" font-size="20">TeamSight · 当前排期</text><text x="16" y="52">${range.start} — ${range.end} · ${analysis.status} · 来源 ${escapeHtml(analysis.fetchedAt)}</text>`,
        `<text x="16" y="74" font-size="11">分析 ${analysis.analysisId} · 分页 ${pages.length + 1}</text>`]
      layout.days.forEach((date, index) => {
        const x = labelWidth + index * layout.config.dayColumnWidth
        pieces.push(`<path d="M${x} ${top - 20}v${layout.totalHeight + 20}" stroke="#e8edf1"/><text x="${x + 3}" y="${top - 7}" font-size="10">${date.slice(5)}</text>`)
      })
      for (const row of layout.rows) {
        const y = top + row.y
        const text = row.type === 'member' ? `${row.memberName} · ${row.taskCount}` : short(row.title, 18)
        pieces.push(`<rect x="8" y="${y}" width="${width - 16}" height="${row.height}" fill="${row.type === 'member' ? '#edf5f6' : '#fff'}"/><text x="16" y="${y + 21}">${escapeHtml(text)}</text><path d="M8 ${y + row.height}H${width - 8}" stroke="#e8edf1"/>`)
      }
      for (const bar of layout.bars) {
        const pair = sources.get(bar.taskId)!
        const color = /^#[\da-f]{6}$/i.test(bar.color) ? bar.color : '#167d7f'
        for (const span of pair.spans) {
          const start = span.start < range.start ? range.start : span.start, end = span.end > range.end ? range.end : span.end
          if (start > end) continue
          const x = labelWidth + dateDiffInDays(range.start, start) * layout.config.dayColumnWidth
          const width = (dateDiffInDays(start, end) + 1) * layout.config.dayColumnWidth
          const virtual = span.kind === 'actual'
          const title = pair.task.title + ' · ' + (virtual ? '按工时补充' : '真实排期') + ' ' + span.start + '—' + span.end + ' · ' + span.memberName
            + ' · 原排期 ' + (pair.task.startDate ?? '缺开始日') + '—' + (pair.task.dueDate ?? '缺结束日')
            + ' · 当前负责人 ' + pair.task.assigneeName + ' · 实际 ' + span.actualDays.map(day => day.date + ' ' + day.hours + 'h').join('、') + ' ' + (pair.task.displayWarning ?? '')
          pieces.push('<g data-virtual="' + virtual + '"><title>' + escapeHtml(title) + '</title><rect x="' + x + '" y="' + (top + bar.y) + '" width="' + width + '" height="' + bar.height + '" rx="4" fill="' + color + '" opacity="' + (virtual ? '.9' : bar.completed ? '.45' : '.9') + '"' + (virtual ? ' stroke="#243447" stroke-width="1.5" stroke-dasharray="3 2"' : '') + '/>'
            + (virtual ? '<text x="' + (x + width / 2) + '" y="' + (top + bar.y + bar.height / 2 + 3) + '" text-anchor="middle" fill="#ffffff" font-size="9">' + (width >= 100 ? '按工时补充' : '补') + '</text>' : '') + '</g>')
        }
      }
      if (!chunk.length) pieces.push(`<text x="16" y="${top + 26}">当前覆盖内无可见排期；完整性以分析状态为准。</text>`)
      pieces.push(`<text x="16" y="${height - 16}" font-size="11">虚线：按工时补充（连续区间不代表每天投入） · 配置成员范围</text></g></svg>`)
      pages.push(pieces.join(''))
    }
  }
  return pages
}

export function renderGantt(analysis: TeamAnalysis, files: BusinessStorage, format: 'svg' | 'png' | 'html') {
  const svgs = ganttSvgs(analysis)
  const refs = { analysisId: analysis.analysisId, snapshotId: analysis.snapshotId }
  if (format === 'html') return [files.putFile('artifact', htmlDocument('TeamSight 排期', svgs.join('')), 'html', 'text/html', refs)]
  return svgs.map(svg => format === 'svg' ? files.putFile('artifact', svg, 'svg', 'image/svg+xml', refs)
    : files.putFile('artifact', new Resvg(svg, { font: { loadSystemFonts: true, defaultFontFamily: process.platform === 'win32' ? 'Microsoft YaHei' : 'PingFang SC' } }).render().asPng(), 'png', 'image/png', refs))
}

function htmlDocument(title: string, content: string) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><title>${escapeHtml(title)}</title><style>body{font-family:system-ui,sans-serif;color:#243447;padding:24px;max-width:1600px;margin:auto}table{border-collapse:collapse;width:100%;margin:20px 0}th,td{border:1px solid #dce4e8;padding:8px;text-align:left}th{background:#edf5f6}svg{max-width:100%;height:auto}li{margin:8px 0}</style></head><body>${content}</body></html>`
}
function dayRows(analysis: TeamAnalysis) {
  return analysis.members.flatMap(member => member.days.map(day => ({ member: member.member.name, staffId: member.member.staffId, date: day.date,
    target: n(day.target), actual: day.reasons.length ? `至少 ${n(day.actual)}，待确认` : n(day.actual), forecast: day.reasons.length ? `已知 ${n(day.allocated)}，待确认` : n(day.allocated),
    deficit: day.reasons.length ? '未知' : n(day.deficit), basis: day.date === analysis.context.analysisDate ? '当天进度' : day.basis === 'actual' ? '历史实际' : '未来预计',
    state: day.state, limitations: day.reasons.map(reason => reason.message).join('；') })))
}
const headings = ['成员', '工号', '日期', '目标(h)', '实际(h)', '预计(h)', '差额(h)', '口径', '状态', '限制']

export function generateReport(analysis: TeamAnalysis, files: BusinessStorage, format: 'markdown' | 'html' | 'csv' | 'json'): FileRecord {
  const refs = { analysisId: analysis.analysisId, snapshotId: analysis.snapshotId }
  if (format === 'json') return files.putFile('artifact', JSON.stringify(analysis, null, 2), 'json', 'application/json', refs)
  const rows = dayRows(analysis).map(row => Object.values(row))
  if (format === 'csv') return files.putFile('artifact', '\ufeff' + [headings, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n'), 'csv', 'text/csv', refs)
  const source = `分析 ${analysis.analysisId}；快照 ${analysis.snapshotId}；来源 ${analysis.fetchedAt}；${analysis.status}；时区 ${analysis.context.timeZone}；规则 ${analysis.context.rulesVersion}；单位小时。`
  const tasks = analysis.snapshot.tasks.map(task => `${task.projectName} · ${task.title} · ${task.startDate ?? '缺开始日'}—${task.dueDate ?? '缺截止日'} · ${task.status} · ${task.projectId}:${task.sourceType}:${task.id} · ${task.tapdUrl}`)
  const limits = [...analysis.limitations, ...analysis.snapshot.issues.map(issue => `${issue.projectId}: ${issue.message}`)]
  const risks = analysis.risks.map(risk => `${risk.message}；依据 ${risk.evidence.join(', ')}`)
  let data: string
  if (format === 'html') {
    const list = (values: string[]) => `<ul>${(values.length ? values : ['当前覆盖内未发现条目']).map(value => `<li>${escapeHtml(value)}</li>`).join('')}</ul>`
    data = htmlDocument('TeamSight 区间工时与当前排期报告', `<h1>TeamSight 区间工时与当前排期报告</h1><p>${escapeHtml(source)}</p><p>${analysis.context.range.start} — ${analysis.context.range.end}</p><h2>每日工时</h2><table><thead><tr>${headings.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(value => `<td>${escapeHtml(value)}</td>`).join('')}</tr>`).join('')}</tbody></table><h2>当前排期</h2>${list(tasks)}<h2>风险与依据</h2>${list(risks)}<h2>数据限制</h2>${list(limits)}`)
  } else {
    const list = (values: string[]) => (values.length ? values : ['当前覆盖内未发现条目']).map(value => `- ${md(value)}`).join('\n')
    data = `# TeamSight 区间工时与当前排期报告\n\n${md(source)}\n\n${analysis.context.range.start} — ${analysis.context.range.end}\n\n## 每日工时\n\n| ${headings.map(md).join(' | ')} |\n| ${headings.map(() => '---').join(' | ')} |\n${rows.map(row => `| ${row.map(md).join(' | ')} |`).join('\n')}\n\n## 当前排期\n\n${list(tasks)}\n\n## 风险与依据\n\n${list(risks)}\n\n## 数据限制\n\n${list(limits)}\n`
  }
  return files.putFile('artifact', data, format === 'html' ? 'html' : 'md', format === 'html' ? 'text/html' : 'text/markdown', refs)
}
