import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const testRoot = process.env.ACG_PULSE_TEST_TEMP_ROOT;
const testDatabaseUrl = process.env.ACG_PULSE_TEST_DATABASE_URL;

if (!testRoot || !testDatabaseUrl) {
  throw new Error('Vitest test database environment was not initialized by vitest.config.ts');
}
if (process.env.DATABASE_URL !== testDatabaseUrl) {
  throw new Error(
    `Test DATABASE_URL is not the isolated test database: expected ${testDatabaseUrl}, got ${process.env.DATABASE_URL}`
  );
}

const expectedDbFile = path.join(path.resolve(testRoot), 'test.db');
const actualDbFile = path.resolve(testDatabaseUrl.replace(/^file:/, ''));
if (actualDbFile !== expectedDbFile) {
  throw new Error(`Refusing to run tests against a database outside the test root: ${actualDbFile}`);
}
if (!fs.existsSync(actualDbFile)) {
  throw new Error(`The isolated test database has not been created: ${actualDbFile}`);
}

interface EnvFileGuardState {
  blockedExists: number;
  blockedReads: number;
  paths: string[];
}

const guardState: EnvFileGuardState = { blockedExists: 0, blockedReads: 0, paths: [] };
(globalThis as Record<string, unknown>).__ACG_PULSE_ENV_GUARD__ = guardState;

const nodeModulesDir = `${path.join(serverDir, 'node_modules')}${path.sep}`;

function isRealEnvFile(filePath: string): boolean {
  if (!filePath.startsWith(`${serverDir}${path.sep}`) || filePath.startsWith(nodeModulesDir)) return false;
  return path.basename(filePath).startsWith('.env');
}

function resolvePath(value: fs.PathLike): string | null {
  try {
    if (value instanceof URL) return path.resolve(fileURLToPath(value));
    return path.resolve(Buffer.isBuffer(value) ? value.toString() : String(value));
  } catch {
    return null;
  }
}

// Prisma and dotenv read env files synchronously during import/configuration.
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
    throw new Error(`Test isolation: refusing to read a real environment file: ${resolved}`);
  }
  return (originalReadFileSync as (...readArgs: unknown[]) => unknown).call(fs, value, ...args);
} as typeof fs.readFileSync;
