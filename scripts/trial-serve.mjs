// Supervisor for the private trial: controls a single child, bounds app logs,
// and supplies only the clean environment set by trial.sh.
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';

const [dir, release, mode] = process.argv.slice(2);
if (!dir || !release || !['foreground', 'background'].includes(mode)
    || process.env.ACG_PULSE_PRIVATE_TRIAL !== '1') throw new Error('Use scripts/trial.sh');
const logPath = join(dir, 'logs', 'server.log');
const maxLog = 2 * 1024 * 1024;
function write(chunk, to) {
  if (existsSync(logPath) && statSync(logPath).size + chunk.length > maxLog) {
    renameSync(logPath, logPath + '.1');
  }
  appendFileSync(logPath, chunk, { mode: 0o600 });
  if (mode === 'foreground' && to) to.write(chunk);
}
const child = spawn(process.execPath, ['dist/index.js'], {
  cwd: join(release, 'server'),
  stdio: ['ignore', 'pipe', 'pipe']
});
child.stdout.on('data', chunk => write(chunk, process.stdout));
child.stderr.on('data', chunk => write(chunk, process.stderr));
child.on('error', error => {
  write(Buffer.from(`[trial] ${error.message}\n`), process.stderr);
  process.exitCode = 1;
});
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  // Server has a Prisma disconnect handler on SIGINT.
  child.kill('SIGINT');
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
child.on('close', (code, signal) => {
  write(Buffer.from(`[trial] exited (${code ?? signal})\n`), process.stderr);
  process.exitCode = stopping ? 0 : (code ?? 1);
});
