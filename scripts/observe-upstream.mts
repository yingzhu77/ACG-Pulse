/**
 * Isolated 12-source upstream observation.
 * Prereq: self-hosted RSSHub reachable at UPSTREAM_RSSHUB_BASE_URL
 * (default http://127.0.0.1:1201), usually through a local socat proxy.
 * Usage: server/node_modules/.bin/tsx scripts/observe-upstream.mts --label=round-a-...
 * Raw JSON is written to UPSTREAM_EVIDENCE_DIR (default tmp/upstream-observation).
 * The run uses a fresh SQLite database, blocks server/.env reads and AI calls,
 * and records per-source health, item counts and RSS request timings.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const serverDir = path.join(projectRoot, 'server');
const checkOnly = process.argv.includes('--check-only');
const labelArg = process.argv.find(arg => arg.startsWith('--label='));
const label = (labelArg?.slice('--label='.length) || new Date().toISOString())
  .replace(/[^0-9A-Za-z._-]/g, '_');

const evidenceDir = path.resolve(
  process.env.UPSTREAM_EVIDENCE_DIR || path.join(projectRoot, 'tmp', 'upstream-observation')
);
const rssHubBase = (process.env.UPSTREAM_RSSHUB_BASE_URL || 'http://127.0.0.1:1201').trim();
fs.mkdirSync(evidenceDir, { recursive: true });
const runRoot = fs.mkdtempSync(path.join(evidenceDir, 'run-'));
const dbFile = path.join(runRoot, 'upstream.db');
const dbUrl = `file:${dbFile.split(path.sep).join('/')}`;
const emptyEnvFile = path.join(runRoot, 'empty.env');
fs.writeFileSync(emptyEnvFile, '');
fs.writeFileSync(path.join(runRoot, '.env'), '');

for (const key of [
  'DEEPSEEK_API_KEY',
  'OPENROUTER_API_KEY',
  'MIMO_API_KEY',
  'BILIBILI_COOKIE'
]) {
  delete process.env[key];
}

Object.assign(process.env, {
  DATABASE_URL: dbUrl,
  DOTENV_CONFIG_PATH: emptyEnvFile,
  RSSHUB_BASE_URLS: rssHubBase,
  RSSHUB_BASE_URL: rssHubBase,
  BILIBILI_DIRECT_API_FALLBACK: 'false',
  SOURCE_CHECK_TIMEOUT_MS: '90000',
  SOURCE_CHECK_CONCURRENCY: '2',
  RSS_FETCH_TIMEOUT_MS: '30000',
  MAX_FEED_ITEMS: '10000',
  HEALTH_LOG_RETENTION_DAYS: '30',
  ANALYSIS_BATCH_DELAY_MS: '0',
  ANALYSIS_TASK_MAX_RETRIES: '0',
  AI_PROVIDER: 'deepseek',
  NODE_ENV: 'test'
});

const prismaTarget = path.join(runRoot, 'prisma');
fs.mkdirSync(prismaTarget, { recursive: true });
fs.copyFileSync(
  path.join(serverDir, 'prisma', 'schema.prisma'),
  path.join(prismaTarget, 'schema.prisma')
);
fs.cpSync(
  path.join(serverDir, 'prisma', 'migrations'),
  path.join(prismaTarget, 'migrations'),
  { recursive: true }
);
fs.writeFileSync(path.join(prismaTarget, '.env'), '');

const migrate = spawnSync(
  process.execPath,
  [
    path.join(serverDir, 'node_modules', 'prisma', 'build', 'index.js'),
    'migrate',
    'deploy',
    '--schema',
    path.join(prismaTarget, 'schema.prisma')
  ],
  {
    cwd: runRoot,
    env: {
      ...process.env,
      DATABASE_URL: dbUrl,
      DOTENV_CONFIG_PATH: emptyEnvFile,
      CHECKPOINT_DISABLE: '1',
      PRISMA_HIDE_UPDATE_MESSAGE: '1'
    },
    encoding: 'utf8',
    timeout: 120_000
  }
);
if (migrate.status !== 0) {
  throw new Error(`prisma migrate deploy failed (${migrate.status}): ${migrate.stderr || migrate.stdout}`);
}
if (!fs.existsSync(dbFile)) throw new Error('isolated database missing after migrate');

interface GuardState {
  blockedExists: number;
  blockedReads: number;
  paths: string[];
}
const guardState: GuardState = { blockedExists: 0, blockedReads: 0, paths: [] };
const nodeModulesDir = `${path.join(serverDir, 'node_modules')}${path.sep}`;

function resolvePath(value: fs.PathLike): string | null {
  try {
    if (value instanceof URL) return path.resolve(fileURLToPath(value));
    return path.resolve(Buffer.isBuffer(value) ? value.toString() : String(value));
  } catch {
    return null;
  }
}
function isRealEnvFile(filePath: string): boolean {
  if (!filePath.startsWith(`${serverDir}${path.sep}`) || filePath.startsWith(nodeModulesDir)) return false;
  return path.basename(filePath).startsWith('.env');
}
const originalExistsSync = fs.existsSync;
const originalReadFileSync = fs.readFileSync;
fs.existsSync = function guardedExistsSync(value: fs.PathLike): boolean {
  const resolved = resolvePath(value);
  if (resolved && isRealEnvFile(resolved)) {
    guardState.blockedExists++;
    guardState.paths.push(resolved);
    return false;
  }
  return originalExistsSync.call(fs, value);
} as typeof fs.existsSync;
fs.readFileSync = function guardedReadFileSync(value: fs.PathLike, ...args: unknown[]): unknown {
  const resolved = resolvePath(value);
  if (resolved && isRealEnvFile(resolved)) {
    guardState.blockedReads++;
    guardState.paths.push(resolved);
    throw new Error(`Observation isolation: refusing to read a real environment file: ${resolved}`);
  }
  return (originalReadFileSync as (...readArgs: unknown[]) => unknown).call(fs, value, ...args);
} as typeof fs.readFileSync;

interface RequestRecord {
  url: string;
  durationMs: number;
  status: string;
}
const requests: RequestRecord[] = [];
const aiAttempts: string[] = [];
const instrumented = new Set<unknown>();

function instrumentAxios(instance: any) {
  if (!instance || instrumented.has(instance)) return;
  instrumented.add(instance);

  const originalGet = instance.get;
  instance.get = async function patchedGet(url: string, config?: unknown) {
    const started = Date.now();
    try {
      const response = await originalGet.call(this, url, config);
      requests.push({
        url: String(url),
        durationMs: Date.now() - started,
        status: 'ok'
      });
      return response;
    } catch (error) {
      const status = (error as any)?.response?.status
        ?? (error as any)?.code
        ?? (error as Error)?.message
        ?? 'error';
      requests.push({
        url: String(url),
        durationMs: Date.now() - started,
        status: String(status)
      });
      throw error;
    }
  };

  const originalPost = instance.post;
  instance.post = async function patchedPost(url: string, ...args: unknown[]) {
    if (String(url).includes('/chat/completions')) {
      aiAttempts.push(String(url));
      throw new Error('AI call blocked by upstream observation harness');
    }
    return originalPost.apply(this, [url, ...args]);
  };
}

const esmAxios = (await import(
  pathToFileURL(path.join(serverDir, 'node_modules', 'axios', 'index.js')).href
)).default;
const serverRequire = createRequire(path.join(serverDir, 'package.json'));
const cjsAxios = serverRequire('axios');
instrumentAxios(esmAxios);
instrumentAxios(cjsAxios);

const { prisma } = await import(pathToFileURL(path.join(serverDir, 'src', 'db.ts')).href);
const databaseList = (await prisma.$queryRawUnsafe<Array<{ name: string; file: string }>>(
  'PRAGMA database_list'
)).map(row => ({ name: row.name, file: row.file }));
const isolated = databaseList.length === 1
  && path.resolve(databaseList[0].file) === path.resolve(dbFile);
if (!isolated) throw new Error('PRAGMA database_list does not point at the isolated database');
if (checkOnly) {
  await prisma.$disconnect();
  console.log(JSON.stringify({ isolated, dbFile, databaseList, guard: guardState }, null, 2));
  console.log('check-only ok');
  process.exit(0);
}

const { seedDefaultSources } = await import(
  pathToFileURL(path.join(serverDir, 'src', 'gamepulse', 'defaultSources.ts')).href
);
const { runGamePulseCheck } = await import(
  pathToFileURL(path.join(serverDir, 'src', 'gamepulse', 'jobs', 'checker.ts')).href
);
const { clearRetryTimerForTest } = await import(
  pathToFileURL(path.join(serverDir, 'src', 'gamepulse', 'ai', 'analysisQueue.ts')).href
);

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

try {
  await seedDefaultSources();
  await prisma.source.deleteMany({ where: { type: { not: 'bilibili_video' } } });
  await prisma.source.updateMany({
    data: { avatar: 'https://example.test/avatar-skip.png' }
  });
  const seededSources = await prisma.source.findMany({
    orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }]
  });
  if (seededSources.length !== 12) {
    throw new Error(`expected 12 Bilibili sources, got ${seededSources.length}`);
  }

  const startedAt = new Date();
  const startedMs = Date.now();
  const result = await runGamePulseCheck();
  const durationMs = Date.now() - startedMs;
  const finishedAt = new Date();

  const drainStarted = Date.now();
  while (Date.now() - drainStarted < 60_000) {
    const open = await prisma.analysisTask.count({
      where: { status: { in: ['pending', 'running'] } }
    });
    if (open === 0) break;
    await sleep(100);
  }
  clearRetryTimerForTest();

  const sources = await prisma.source.findMany({
    orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }]
  });
  const logs = await prisma.sourceHealthLog.findMany({ orderBy: { checkedAt: 'asc' } });
  const grouped = await prisma.feedItem.groupBy({
    by: ['sourceId'],
    _count: { _all: true }
  });
  const newItemsBySource = new Map(grouped.map(row => [row.sourceId, row._count._all]));
  const latestLogBySource = new Map<string, typeof logs[number]>();
  for (const log of logs) latestLogBySource.set(log.sourceId, log);

  const perSource = sources.map(source => {
    const log = latestLogBySource.get(source.id);
    return {
      uid: source.uid,
      name: source.name,
      game: source.game,
      healthStatus: source.healthStatus,
      lastSuccessAt: source.lastSuccessAt?.toISOString() ?? null,
      lastCheckedAt: source.lastCheckedAt?.toISOString() ?? null,
      lastError: source.lastError,
      newItems: newItemsBySource.get(source.id) ?? 0,
      logStatus: log?.status ?? null,
      logError: log?.error ?? null,
      completionOffsetMs: source.lastCheckedAt ? source.lastCheckedAt.getTime() - startedMs : null,
      logOffsetMs: log ? log.checkedAt.getTime() - startedMs : null
    };
  });

  const byUid = new Map<string, RequestRecord[]>();
  for (const request of requests) {
    const match = request.url.match(/\/user\/video\/(\d+)/);
    const key = match?.[1] ?? 'other';
    const bucket = byUid.get(key) ?? [];
    bucket.push(request);
    byUid.set(key, bucket);
  }
  const requestSummary = Array.from(byUid.entries()).map(([uid, rows]) => ({
    uid,
    count: rows.length,
    failures: rows.filter(row => row.status !== 'ok').length,
    maxDurationMs: Math.max(...rows.map(row => row.durationMs)),
    totalDurationMs: rows.reduce((sum, row) => sum + row.durationMs, 0),
    statuses: Array.from(new Set(rows.map(row => row.status)))
  }));

  const report = {
    label,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs,
    isolated,
    dbFile,
    guard: {
      blockedExists: guardState.blockedExists,
      blockedReads: guardState.blockedReads,
      pathsBlocked: Array.from(new Set(guardState.paths.map(item => path.basename(item))))
    },
    check: result,
    seededSources: seededSources.length,
    analysisTasks: {
      pendingOrRunning: await prisma.analysisTask.count({
        where: { status: { in: ['pending', 'running'] } }
      }),
      failed: await prisma.analysisTask.count({ where: { status: 'failed' } })
    },
    aiAttempts,
    perSource,
    requests: requestSummary,
    requestCount: requests.length,
    requestFailures: requests.filter(request => request.status !== 'ok').length
  };

  const outputFile = path.join(evidenceDir, `round-${label}.json`);
  fs.writeFileSync(outputFile, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ outputFile, ...report }, null, 2));
} finally {
  await prisma.$disconnect();
}
