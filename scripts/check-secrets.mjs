#!/usr/bin/env node
/**
 * 令牌泄漏审计：确认 TAPD personal token 没有进入构建产物、文档或日志。
 *
 * 用法：node scripts/check-secrets.mjs [额外扫描目录...]
 * 退出码：0 = 未发现泄漏；1 = 发现泄漏或缺少令牌来源（.env.local）。
 * 安全：脚本只读取令牌用于比对，绝不打印令牌内容。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_TARGETS = [
  'apps/server/dist',
  'apps/mcp-ui/dist',
  'packages/core/dist',
  'packages/tapd/dist',
  'README.md',
  'docs',
  'artifacts',
];
const SKIP_DIRS = new Set(['node_modules', '.git']);
/** 跳过超大文件（压缩包等），它们的二进制内容无法按文本比对。 */
const MAX_FILE_BYTES = 64 * 1024 * 1024;

function readToken() {
  const envPath = join(REPO_ROOT, '.env.local');
  if (!existsSync(envPath)) return null;
  const matched = /^PERSONAL_TOKEN=(.*)$/m.exec(readFileSync(envPath, 'utf8'));
  const token = matched?.[1]?.trim().replace(/^"|"$/g, '') ?? '';
  return token.length >= 8 ? token : null;
}

function* walk(path) {
  let stats;
  try {
    stats = statSync(path);
  } catch {
    return;
  }
  if (stats.isFile()) {
    if (stats.size <= MAX_FILE_BYTES) yield path;
    return;
  }
  if (!stats.isDirectory()) return;
  for (const entry of readdirSync(path)) {
    if (SKIP_DIRS.has(entry)) continue;
    yield* walk(join(path, entry));
  }
}

const token = readToken();
if (!token) {
  console.error('未在 .env.local 中找到可用的 PERSONAL_TOKEN，无法执行泄漏比对');
  process.exit(1);
}

const targets = [...DEFAULT_TARGETS, ...process.argv.slice(2)];
const scanned = [];
const leaks = [];
const missing = [];

for (const target of targets) {
  const absolute = resolve(REPO_ROOT, target);
  if (!existsSync(absolute)) {
    missing.push(target);
    continue;
  }
  for (const file of walk(absolute)) {
    scanned.push(file);
    let content;
    try {
      content = readFileSync(file, 'latin1');
    } catch {
      continue;
    }
    if (content.includes(token)) leaks.push(relative(REPO_ROOT, file));
  }
}

console.log(`扫描文件数：${scanned.length}`);
if (missing.length > 0) {
  console.log(`跳过（不存在）：${missing.join('、')}`);
}

if (leaks.length > 0) {
  console.error(`发现令牌明文（${leaks.length} 个文件）：`);
  for (const file of leaks) console.error(`  - ${file}`);
  process.exit(1);
}

console.log('未发现令牌明文泄漏');
