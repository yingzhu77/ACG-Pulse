#!/usr/bin/env node
import { chmodSync, existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultEnvPath = path.join(repoRoot, '.env');
const cookieName = 'BILIBILI_COOKIE';

function usage() {
  console.log(`用法:
  node scripts/set-bilibili-cookie.mjs                  交互式隐藏输入
  node scripts/set-bilibili-cookie.mjs --from-clipboard 从剪贴板读取
  node scripts/set-bilibili-cookie.mjs --skip-route     不检查 RSSHub 路由
  node scripts/set-bilibili-cookie.mjs --no-recreate    只更新 .env
  node scripts/set-bilibili-cookie.mjs --env-file <path> 指定 .env（测试用）
  node scripts/set-bilibili-cookie.mjs --dry-run        只校验，不写入

脚本会先调用 B站 nav 接口校验登录态，再原子更新根目录 .env，重建 rsshub，
最后检查容器内登录态和一条 B站路由。Cookie 不会打印到终端。`);
}

function getArgValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function normalizeCookie(raw) {
  let cookie = String(raw || '').replace(/\r?\n/g, ' ').trim();
  if (/^cookie\s*:/i.test(cookie)) cookie = cookie.replace(/^cookie\s*:/i, '').trim();
  if (
    (cookie.startsWith("'") && cookie.endsWith("'")) ||
    (cookie.startsWith('"') && cookie.endsWith('"'))
  ) {
    cookie = cookie.slice(1, -1).trim();
  }
  if (!cookie) throw new Error('Cookie 为空');
  if (cookie.includes('\0') || cookie.includes('\n') || cookie.includes('\r')) {
    throw new Error('Cookie 包含非法换行或空字符');
  }
  if (cookie.includes("'")) throw new Error('Cookie 包含单引号，无法安全写入 .env');

  const values = new Map();
  for (const part of cookie.split(';')) {
    const pair = part.trim();
    if (!pair) continue;
    const index = pair.indexOf('=');
    if (index <= 0) throw new Error('Cookie 格式不正确，应为 name=value; name=value');
    const name = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    if (!value) throw new Error(`Cookie 项 ${name} 的值为空`);
    values.set(name, value);
  }
  if (!values.has('SESSDATA')) throw new Error('Cookie 缺少 SESSDATA');
  if (!values.has('bili_jct')) throw new Error('Cookie 缺少 bili_jct');
  if (!values.has('DedeUserID')) console.warn('警告：Cookie 缺少 DedeUserID，部分接口可能不可用');
  return cookie;
}

function getCookieValue(cookie, name) {
  for (const part of cookie.split(';')) {
    const pair = part.trim();
    const index = pair.indexOf('=');
    if (index > 0 && pair.slice(0, index).trim() === name) {
      return pair.slice(index + 1).trim();
    }
  }
  return undefined;
}

async function validateCookie(cookie) {
  const response = await fetch('https://api.bilibili.com/x/web-interface/nav', {
    headers: {
      Cookie: cookie,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      Referer: 'https://www.bilibili.com/',
      Accept: 'application/json, text/plain, */*'
    },
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`B站 nav 请求失败：HTTP ${response.status}`);
  const data = await response.json();
  if (data.code !== 0 || !data.data?.isLogin) {
    throw new Error(`Cookie 登录态无效：code=${data.code ?? 'unknown'}, isLogin=${Boolean(data.data?.isLogin)}`);
  }
  const dedeUserId = getCookieValue(cookie, 'DedeUserID');
  if (dedeUserId && String(data.data.mid) !== dedeUserId) {
    throw new Error('Cookie 内的 DedeUserID 与 nav 返回的 mid 不一致，可能混入了不同账号的 Cookie');
  }
  return { mid: data.data.mid };
}

function readFromClipboard() {
  if (process.platform === 'win32') {
    const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', 'Get-Clipboard -Raw'], {
      encoding: 'utf8'
    });
    if (result.status !== 0) throw new Error('读取剪贴板失败');
    return result.stdout;
  }

  if (process.platform === 'darwin') {
    const result = spawnSync('pbpaste', [], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error('读取剪贴板失败');
    return result.stdout;
  }

  for (const [command, args] of [
    ['wl-paste', ['--no-newline']],
    ['xclip', ['-selection', 'clipboard', '-o']],
    ['xsel', ['--clipboard', '--output']]
  ]) {
    const result = spawnSync(command, args, { encoding: 'utf8' });
    if (result.status === 0) return result.stdout;
  }
  throw new Error('未找到可用的剪贴板工具，请使用交互式输入');
}

function readHiddenInput() {
  console.log('请粘贴 B站 Cookie（输入不显示），然后按 Enter：');
  if (!process.stdin.isTTY) {
    throw new Error('当前终端不支持隐藏输入；请先复制 Cookie，再运行 --from-clipboard');
  }

  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    let value = '';
    const cleanup = () => {
      stdin.removeListener('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
    };
    const finish = result => {
      cleanup();
      process.stdout.write('\n');
      resolve(result);
    };
    const onData = chunk => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') {
          finish(value);
          return;
        }
        if (char === '\u0003') {
          cleanup();
          process.stdout.write('\n');
          reject(new Error('已取消'));
          return;
        }
        if (char === '\u007f' || char === '\b') {
          value = value.slice(0, -1);
          continue;
        }
        value += char;
      }
    };
    stdin.setEncoding('utf8');
    stdin.on('data', onData);
    try {
      stdin.setRawMode(true);
    } catch {
      stdin.removeListener('data', onData);
      reject(new Error('无法关闭终端回显；请先复制 Cookie，再运行 --from-clipboard'));
      return;
    }
    stdin.resume();
  });
}

function upsertEnvCookie(envPath, cookie) {
  let content = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
  const bom = content.startsWith('\uFEFF') ? '\uFEFF' : '';
  if (bom) content = content.slice(1);
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = content ? content.split(/\r?\n/) : [];
  if (lines.length && lines[lines.length - 1] === '') lines.pop();

  const newLine = `${cookieName}='${cookie}'`;
  let replaced = false;
  const nextLines = [];
  for (const line of lines) {
    if (new RegExp(`^\\s*${cookieName}\\s*=`).test(line)) {
      if (!replaced) {
        nextLines.push(newLine);
        replaced = true;
      }
      continue;
    }
    nextLines.push(line);
  }
  if (!replaced) nextLines.push(newLine);

  const output = bom + nextLines.join(eol) + eol;
  const tempPath = `${envPath}.tmp-${process.pid}`;
  writeFileSync(tempPath, output, { encoding: 'utf8', mode: 0o600 });
  try {
    renameSync(tempPath, envPath);
  } catch {
    writeFileSync(envPath, output, { encoding: 'utf8' });
    try {
      unlinkSync(tempPath);
    } catch {
      // temp cleanup is best effort
    }
  }
  try {
    chmodSync(envPath, 0o600);
  } catch {
    // Windows ACLs are not changed by chmod
  }
}

function warnAboutPerUidOverrides(content) {
  const overrides = [...content.matchAll(/^\s*(BILIBILI_COOKIE_\d+)\s*=\s*(.*)$/gm)]
    .filter(match => match[2].replace(/^['"]|['"]$/g, '').trim());
  if (overrides.length > 0) {
    console.warn(`警告：检测到 ${overrides.length} 个 per-UID Cookie 覆盖项（${overrides.map(match => match[1]).join('、')}）；主 Compose 不使用它们，开发 Compose 会优先使用。如非多账号覆盖，请删除或同步这些行。`);
  }
}

function runDocker(args, options = {}) {
  const result = spawnSync('docker', args, { encoding: 'utf8', ...options });
  if (result.error) throw new Error(`无法执行 Docker：${result.error.message}`);
  return result;
}

function recreateRssHub() {
  console.log('正在重建 RSSHub...');
  const env = { ...process.env };
  env.CLIENT_URL ||= 'https://example.invalid';
  env.ADMIN_PASSWORD ||= 'anonymous-placeholder';
  env.ADMIN_JWT_SECRET ||= 'anonymous-placeholder-secret-at-least-32-chars';
  const result = runDocker(['compose', 'up', '-d', '--force-recreate', 'rsshub'], {
    cwd: repoRoot,
    stdio: 'inherit',
    env
  });
  if (result.status !== 0) throw new Error('RSSHub 重建失败，请检查 Docker 和 Compose 配置');
}

function checkContainerCookie() {
  const present = runDocker([
    'exec',
    'game-pulse-rsshub',
    'sh',
    '-c',
    'if [ -n "$BILIBILI_COOKIE_401742377" ]; then echo present; else echo empty; fi'
  ]);
  if (present.status !== 0) throw new Error('无法检查 RSSHub 容器 Cookie');
  if (!present.stdout.includes('present')) throw new Error('RSSHub 容器没有收到 Cookie，请确认 .env 已更新并重建容器');

  const nav = runDocker([
    'exec',
    'game-pulse-rsshub',
    'sh',
    '-c',
    'curl -ksS --max-time 20 -H "Cookie: $BILIBILI_COOKIE_401742377" "https://api.bilibili.com/x/web-interface/nav"'
  ]);
  if (nav.status !== 0) throw new Error('RSSHub 容器内 nav 请求失败');
  try {
    const data = JSON.parse(nav.stdout);
    return {
      ok: data.code === 0 && data.data?.isLogin === true,
      code: data.code,
      isLogin: Boolean(data.data?.isLogin)
    };
  } catch {
    throw new Error('RSSHub 容器内 nav 返回非 JSON');
  }
}

async function checkHealth() {
  for (let attempt = 1; attempt <= 15; attempt += 1) {
    const result = runDocker([
      'exec',
      'game-pulse-rsshub',
      'curl',
      '-fsS',
      'http://localhost:1200/healthz'
    ]);
    if (result.status === 0 && result.stdout.includes('ok')) return;
    if (attempt < 15) await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw new Error('RSSHub healthz 未通过（已等待 30 秒）');
}

async function checkRoute() {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    console.log(`正在检查 B站 RSSHub 路由（第 ${attempt}/2 次，最多 45 秒）...`);
    const script = [
      'curl -ksS --max-time 45 -o /tmp/bili-cookie-check.xml -w "%{http_code}"',
      '"http://localhost:1200/bilibili/user/video/401742377";',
      'echo;',
      'grep -o "<item>" /tmp/bili-cookie-check.xml | wc -l;',
      'rm -f /tmp/bili-cookie-check.xml'
    ].join(' ');
    const result = runDocker(['exec', 'game-pulse-rsshub', 'sh', '-c', script], { timeout: 75000 });
    const [statusLine, itemLine] = String(result.stdout || '').trim().split(/\r?\n/);
    const status = Number(statusLine);
    const items = Number(itemLine) || 0;
    if (status === 200 && items > 0) {
      console.log(`路由检查通过：HTTP ${status}，${items} 个 <item>。`);
      return;
    }
    if (attempt === 1) {
      console.warn(`路由检查未通过：HTTP ${statusLine || 'timeout'}，${items} 个 <item>；10 秒后重试。`);
      await new Promise(resolve => setTimeout(resolve, 10000));
      continue;
    }
    console.warn(`路由检查未通过：HTTP ${statusLine || 'timeout'}，${items} 个 <item>。`);
    console.warn('Cookie 登录态已生效；路由失败可能是上游风控或缓存冷启动，可稍后重试或查看 docker logs game-pulse-rsshub --tail 200。');
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    usage();
    return;
  }

  const envPath = path.resolve(getArgValue(args, '--env-file') || defaultEnvPath);
  const raw = args.includes('--from-clipboard') ? readFromClipboard() : await readHiddenInput();
  const cookie = normalizeCookie(raw);

  console.log('正在校验 B站登录态...');
  const session = await validateCookie(cookie);
  console.log(`登录态有效（mid=${session.mid}）。`);

  if (args.includes('--dry-run')) {
    console.log(`dry-run：将更新 ${envPath}，未写入。`);
    return;
  }

  const existing = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
  warnAboutPerUidOverrides(existing);
  upsertEnvCookie(envPath, cookie);
  console.log(`Cookie 已写入 ${envPath}。`);

  if (args.includes('--no-recreate')) {
    console.log('已跳过 RSSHub 重建。');
    return;
  }

  recreateRssHub();
  await checkHealth();
  const container = checkContainerCookie();
  if (!container.ok) {
    throw new Error(`容器内登录态无效：code=${container.code}, isLogin=${container.isLogin}`);
  }
  console.log('RSSHub healthz 通过，容器内登录态有效。');

  if (!args.includes('--skip-route')) await checkRoute();
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (fileURLToPath(import.meta.url) === invokedPath) {
  main().catch(error => {
    console.error(`失败：${error.message}`);
    process.exitCode = 1;
  });
}

export { normalizeCookie, upsertEnvCookie };
