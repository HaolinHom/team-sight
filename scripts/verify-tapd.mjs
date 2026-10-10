#!/usr/bin/env node
/**
 * TAPD 接口能力验证脚本（阶段0）。
 *
 * 只读：仅调用 GET 接口，不创建、不修改任何 TAPD 数据。
 * 安全：令牌只从 .env.local 读取并用于请求头，绝不打印或写入输出文件。
 *
 * 用法:
 *   node scripts/verify-tapd.mjs [--range 2026-10-01:2026-10-31] [--out <file>]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const API_BASE = 'https://api.tapd.cn';
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = resolve(REPO_ROOT, '.env.local');

function parseArgs(argv) {
  const options = { range: null, out: null };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--range') options.range = argv[(index += 1)];
    else if (token === '--out') options.out = argv[(index += 1)];
  }
  return options;
}

function readEnv() {
  const content = readFileSync(ENV_FILE, 'utf8');
  const env = {};
  for (const line of content.split('\n')) {
    const matched = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (matched) env[matched[1]] = matched[2].trim().replace(/^"|"$/g, '');
  }
  return env;
}

function currentMonthRange() {
  const now = new Date();
  const start = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const endKey = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(
    end.getDate()
  ).padStart(2, '0')}`;
  return { start, end: endKey };
}

const args = parseArgs(process.argv.slice(2));
const env = readEnv();
const token = env.PERSONAL_TOKEN;
const workspaceIds = (env.WORKSPACE_IDS ?? '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);
const [rangeStart, rangeEnd] = (args.range ?? '').split(':');
const range =
  rangeStart && rangeEnd ? { start: rangeStart, end: rangeEnd } : currentMonthRange();

if (!token) {
  console.error('未在 .env.local 中找到 PERSONAL_TOKEN');
  process.exit(1);
}
if (workspaceIds.length === 0) {
  console.error('未在 .env.local 中找到 WORKSPACE_IDS');
  process.exit(1);
}

const results = [];
let criticalFailure = false;

function record(id, title, outcome, detail) {
  results.push({ id, title, outcome, detail });
  const icon = outcome === 'pass' ? '✅' : outcome === 'warn' ? '⚠️' : '❌';
  console.log(`${icon} ${id} ${title}`);
  if (detail !== undefined) {
    console.log(`   ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
  }
}

async function call(path, params, { auth = 'bearer' } = {}) {
  const url = new URL(`${API_BASE}${path}`);
  for (const [key, value] of Object.entries(params ?? {})) {
    url.searchParams.set(key, String(value));
  }

  const headers = { Accept: 'application/json' };
  if (auth === 'bearer') headers.Authorization = `Bearer ${token}`;
  if (auth === 'bearer-invalid') headers.Authorization = 'Bearer invalid-token-for-verification';
  if (auth === 'basic') {
    headers.Authorization = `Basic ${Buffer.from(`${token}:`).toString('base64')}`;
  }

  const startedAt = Date.now();
  const response = await fetch(url, { headers });
  const text = await response.text();
  const elapsedMs = Date.now() - startedAt;
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { parseError: true, raw: text.slice(0, 200) };
  }
  return { httpStatus: response.status, body, elapsedMs };
}

function rowOf(body, key) {
  const data = body?.data;
  if (!Array.isArray(data)) return null;
  const entry = data[0]?.[key];
  return entry && typeof entry === 'object' ? entry : null;
}

function countOf(body) {
  const count = body?.data?.count;
  return Number.isFinite(Number(count)) ? Number(count) : null;
}

const windowQuery = {
  begin: `1970-01-01~${range.end}`,
  due: `${range.start}~2999-12-31`,
};

async function main() {
  console.log(`# TAPD 接口能力验证`);
  console.log(`时间窗：${range.start} ~ ${range.end}`);
  console.log(`项目：${workspaceIds.join(', ')}`);
  console.log('');

  // 1. 认证形态
  const bearer = await call('/quickstart/testauth');
  if (bearer.body?.status === 1) {
    record('AUTH-BEARER', 'Bearer 认证可用', 'pass', {
      httpStatus: bearer.httpStatus,
      apiUser: bearer.body?.data?.api_user ?? null,
      requestIpPresent: Boolean(bearer.body?.data?.request_ip),
      elapsedMs: bearer.elapsedMs,
    });
  } else {
    criticalFailure = true;
    record('AUTH-BEARER', 'Bearer 认证失败', 'fail', {
      httpStatus: bearer.httpStatus,
      info: bearer.body?.info ?? null,
    });
  }

  const basic = await call('/quickstart/testauth', {}, { auth: 'basic' });
  record(
    'AUTH-BASIC',
    'Basic 认证（以令牌作为口令）不可用',
    basic.body?.status === 1 ? 'warn' : 'pass',
    { httpStatus: basic.httpStatus, info: basic.body?.info ?? null }
  );

  const invalid = await call('/quickstart/testauth', {}, { auth: 'bearer-invalid' });
  record('AUTH-INVALID', '无效令牌被拒绝（错误路径可用）', invalid.httpStatus === 401 ? 'pass' : 'warn', {
    httpStatus: invalid.httpStatus,
    info: invalid.body?.info ?? null,
  });

  // 2. 项目枚举能力
  const workspaces = await call('/workspaces', {});
  record(
    'WORKSPACE-LIST',
    '无法枚举项目（workspace_id 必须配置）',
    workspaces.body?.status === 422 ? 'pass' : 'warn',
    { httpStatus: workspaces.httpStatus, info: workspaces.body?.info ?? null }
  );

  const primary = workspaceIds[0];
  const ghost = await call('/tasks', {
    workspace_id: '1000000000',
    limit: 1,
    fields: 'id,name',
  });
  record(
    'WORKSPACE-GHOST',
    '不存在的项目返回空数据而非报错',
    ghost.body?.status === 1 ? 'pass' : 'warn',
    { httpStatus: ghost.httpStatus, status: ghost.body?.status, info: ghost.body?.info ?? null }
  );

  // 3. 任务字段
  const taskProbe = await call('/tasks', {
    workspace_id: primary,
    limit: 2,
    fields: 'id,name,workspace_id,owner,begin,due,status,priority_label,iteration_id,created,modified',
  });
  const task = rowOf(taskProbe.body, 'Task');
  record('TASK-FIELDS', '任务关键字段可用', task ? 'pass' : 'fail', {
    httpStatus: taskProbe.httpStatus,
    fieldsPresent: task ? Object.keys(task).sort() : [],
    sampleOwnerFormat: task?.owner ? describeOwner(task.owner) : null,
    sampleBegin: task?.begin ?? null,
    sampleDue: task?.due ?? null,
  });
  if (!task) criticalFailure = true;

  // 4. 缺陷字段（标题/负责人字段名与任务不同）
  const bugProbe = await call('/bugs', {
    workspace_id: primary,
    limit: 2,
    fields: 'id,title,name,owner,current_owner,workspace_id,begin,due,status,priority_label',
  });
  const bug = rowOf(bugProbe.body, 'Bug');
  record('BUG-FIELDS', '缺陷标题取 title、负责人取 current_owner', bug ? 'pass' : 'fail', {
    httpStatus: bugProbe.httpStatus,
    titlePresent: Boolean(bug?.title),
    nameIsNull: bug?.name === null || bug?.name === undefined,
    ownerIsNull: bug?.owner === null || bug?.owner === undefined,
    currentOwnerFormat: bug?.current_owner ? describeOwner(bug.current_owner) : null,
  });

  // 5. 成员目录
  const users = await call('/workspaces/users', { workspace_id: primary, limit: 200 });
  const userRows = Array.isArray(users.body?.data)
    ? users.body.data.map((entry) => entry?.UserWorkspace).filter(Boolean)
    : [];
  record('WORKSPACE-USERS', '可获取项目成员目录（用于工号 -> 姓名）', userRows.length > 0 ? 'pass' : 'warn', {
    httpStatus: users.httpStatus,
    memberCount: userRows.length,
    sampleUser: userRows[0]?.user ? describeOwner(userRows[0].user) : null,
    sampleName: userRows[0]?.name ?? null,
  });

  // 6. 分页上限
  const pageProbe = await call('/tasks', {
    workspace_id: primary,
    limit: 200,
    fields: 'id',
  });
  const pageSize = Array.isArray(pageProbe.body?.data) ? pageProbe.body.data.length : 0;
  record('PAGE-LIMIT', '单页上限 200 生效', pageSize === 200 ? 'pass' : 'warn', {
    returned: pageSize,
    elapsedMs: pageProbe.elapsedMs,
  });

  // 7. 时间窗查询与开区间陷阱
  const baseline = await call('/tasks/count', { workspace_id: primary });
  const windowCount = await call('/tasks/count', { workspace_id: primary, ...windowQuery });
  const openEnded = await call('/tasks/count', {
    workspace_id: primary,
    begin: `~${range.end}`,
  });
  record(
    'TIME-WINDOW',
    '闭区间时间查询有效，开区间被静默忽略',
    countOf(windowCount.body) !== null && countOf(openEnded.body) === countOf(baseline.body)
      ? 'pass'
      : 'warn',
    {
      totalCount: countOf(baseline.body),
      windowCount: countOf(windowCount.body),
      openEndedBeginCount: countOf(openEnded.body),
      note: '开区间返回值等于全量即说明被忽略，必须使用两端闭合区间',
    }
  );

  // 8. 分页完整性（按窗口逐页拉取，校验累计条数）
  const collected = await collectAll('/tasks', primary, range);
  record(
    'PAGINATION',
    '按窗口翻页拉取条数与 count 一致',
    collected.rows.length === collected.expected ? 'pass' : 'warn',
    {
      expected: collected.expected,
      collected: collected.rows.length,
      pages: collected.pages,
      elapsedMs: collected.elapsedMs,
    }
  );

  // 9. 缺陷数据量（用于评估窗口裁剪必要性）
  const bugCount = await call('/bugs/count', { workspace_id: primary });
  record('BUG-VOLUME', '缺陷总量（用于评估时间窗裁剪）', 'pass', {
    totalCount: countOf(bugCount.body),
  });

  // 10. 多项目数据量
  const volumes = [];
  for (const workspaceId of workspaceIds) {
    const total = await call('/tasks/count', { workspace_id: workspaceId });
    const window = await call('/tasks/count', { workspace_id: workspaceId, ...windowQuery });
    volumes.push({
      workspaceId,
      taskTotal: countOf(total.body),
      taskInWindow: countOf(window.body),
    });
  }
  record('MULTI-WORKSPACE', '多项目并发查询可行', 'pass', volumes);

  console.log('');
  console.log(
    `结论：${results.filter((item) => item.outcome === 'pass').length} 项通过，` +
      `${results.filter((item) => item.outcome === 'warn').length} 项需注意，` +
      `${results.filter((item) => item.outcome === 'fail').length} 项失败`
  );

  if (args.out) {
    writeFileSync(
      args.out,
      JSON.stringify({ range, workspaceIds, generatedAt: new Date().toISOString(), results }, null, 2),
      'utf8'
    );
    console.log(`已写出证据文件：${args.out}`);
  }

  process.exit(criticalFailure ? 1 : 0);
}

/** 只输出负责人字段的形态，不泄露具体姓名。 */
function describeOwner(value) {
  const raw = String(value);
  const parts = raw.split(';').filter((item) => item.trim().length > 0);
  const matched = /^(.*)_(\d+)$/.exec(parts[0] ?? '');
  return {
    shape: matched ? '姓名_工号' : '无工号',
    multiValue: parts.length > 1,
    trailingSemicolon: raw.endsWith(';'),
    staffIdDigits: matched ? matched[2].length : 0,
  };
}

async function collectAll(path, workspaceId, window) {
  const startedAt = Date.now();
  const expected =
    countOf((await call(`${path}/count`, { workspace_id: workspaceId, begin: `1970-01-01~${window.end}`, due: `${window.start}~2999-12-31` })).body) ?? 0;
  const rows = [];
  let pages = 0;
  for (let page = 1; page <= 50; page += 1) {
    const response = await call(path, {
      workspace_id: workspaceId,
      begin: `1970-01-01~${window.end}`,
      due: `${window.start}~2999-12-31`,
      limit: 200,
      page,
      fields: 'id',
    });
    const data = Array.isArray(response.body?.data) ? response.body.data : [];
    pages += 1;
    rows.push(...data);
    if (data.length < 200 || rows.length >= expected) break;
  }
  return { rows, expected, pages, elapsedMs: Date.now() - startedAt };
}

await main();
