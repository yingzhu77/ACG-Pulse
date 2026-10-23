import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

const testBaseRoot = process.env.ACG_PULSE_TEST_TEMP_ROOT
  || path.join(os.tmpdir(), 'acg-pulse-vitest');
// Global teardown removes testRoot recursively; always isolate it from the user-provided base.
const testRoot = path.join(testBaseRoot, randomUUID());
const testDatabaseUrl = `file:${path.join(testRoot, 'test.db').split(path.sep).join('/')}`;
const emptyEnvFile = path.join(testRoot, 'empty.env');

process.env.ACG_PULSE_TEST_TEMP_ROOT = testRoot;
process.env.ACG_PULSE_TEST_DATABASE_URL = testDatabaseUrl;
process.env.DATABASE_URL = testDatabaseUrl;
process.env.DOTENV_CONFIG_PATH = emptyEnvFile;

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**'],
    globalSetup: ['./vitest.global-setup.ts'],
    setupFiles: ['./vitest.setup.ts'],
    env: {
      DATABASE_URL: testDatabaseUrl,
      ACG_PULSE_TEST_DATABASE_URL: testDatabaseUrl,
      ACG_PULSE_TEST_TEMP_ROOT: testRoot,
      DOTENV_CONFIG_PATH: emptyEnvFile
    }
  }
});
