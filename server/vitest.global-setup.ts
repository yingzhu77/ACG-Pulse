import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = path.dirname(fileURLToPath(import.meta.url));

export default function setup(): () => void {
  const testRoot = process.env.ACG_PULSE_TEST_TEMP_ROOT;
  const testDatabaseUrl = process.env.ACG_PULSE_TEST_DATABASE_URL;
  if (!testRoot || !testDatabaseUrl) {
    throw new Error('Vitest test database environment was not initialized by vitest.config.ts');
  }

  const resolvedRoot = path.resolve(testRoot);
  const resolvedDb = path.resolve(testDatabaseUrl.replace(/^file:/, ''));
  if (resolvedDb !== path.join(resolvedRoot, 'test.db')) {
    throw new Error(`Refusing to run tests against a database outside the test root: ${resolvedDb}`);
  }
  if (resolvedRoot === path.resolve(serverDir) || resolvedRoot.startsWith(`${path.resolve(serverDir)}${path.sep}`)) {
    throw new Error(`Refusing to create the test database inside the server directory: ${resolvedRoot}`);
  }

  const prismaTarget = path.join(resolvedRoot, 'prisma');
  const schemaTarget = path.join(prismaTarget, 'schema.prisma');
  const emptyEnvFile = path.join(resolvedRoot, 'empty.env');
  const prismaCli = path.join(serverDir, 'node_modules', 'prisma', 'build', 'index.js');

  try {
    fs.mkdirSync(prismaTarget, { recursive: true });
    fs.copyFileSync(path.join(serverDir, 'prisma', 'schema.prisma'), schemaTarget);
    fs.cpSync(path.join(serverDir, 'prisma', 'migrations'), path.join(prismaTarget, 'migrations'), { recursive: true });
    fs.writeFileSync(emptyEnvFile, '');
    // Empty env files keep any Prisma CLI auto-loading away from a developer's real environment.
    fs.writeFileSync(path.join(resolvedRoot, '.env'), '');
    fs.writeFileSync(path.join(prismaTarget, '.env'), '');

    // Running from the temp directory keeps the CLI from discovering server/prisma.config.ts
    // or loading server/.env; the copied migrations are applied to the temp database.
    const result = spawnSync(
      process.execPath,
      [prismaCli, 'migrate', 'deploy', '--schema', schemaTarget],
      {
        cwd: resolvedRoot,
        env: {
          ...process.env,
          DATABASE_URL: testDatabaseUrl,
          DOTENV_CONFIG_PATH: emptyEnvFile,
          CHECKPOINT_DISABLE: '1',
          PRISMA_HIDE_UPDATE_MESSAGE: '1'
        },
        encoding: 'utf8',
        timeout: 120_000
      }
    );

    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(
        `Prisma migrate deploy failed with status ${result.status}\n${result.stdout || ''}\n${result.stderr || ''}`
      );
    }
    if (!fs.existsSync(resolvedDb)) {
      throw new Error(`Prisma reported success but the test database is missing: ${resolvedDb}`);
    }
  } catch (error) {
    fs.rmSync(resolvedRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    throw error;
  }

  return () => {
    try {
      fs.rmSync(resolvedRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch (error) {
      console.warn(`Failed to remove the test database directory ${resolvedRoot}:`, error);
    }
  };
}
