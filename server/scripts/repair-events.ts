// Explicit, offline CLI. No automatic startup migration and no application .env lookup.
import { open, realpath } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

async function main() {
  const { values } = parseArgs({ options: {
    db: { type: 'string' }, since: { type: 'string' }, until: { type: 'string' },
    game: { type: 'string' }, apply: { type: 'string' }, help: { type: 'boolean' }
  } });
  if (values.help) {
    console.log('npm run repair:events -- --db /absolute/path/to/copy.db --since YYYY-MM-DD --until YYYY-MM-DD [--game GAME] [--apply FINGERPRINT]');
    return;
  }
  const day = (value: string | undefined) => {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Use YYYY-MM-DD for both boundaries (Asia/Shanghai, end exclusive)');
    const iso = new Date(value + 'T00:00:00Z');
    if (Number.isNaN(+iso) || iso.toISOString().slice(0, 10) !== value) throw new Error('Invalid date');
    return new Date(value + 'T00:00:00+08:00');
  };
  const scope = { since: day(values.since), until: day(values.until), game: values.game };
  if (!values.db || !isAbsolute(values.db)) throw new Error('Pass an absolute path to an existing isolated SQLite copy');
  if (values.apply !== undefined && !/^[0-9a-f]{64}$/.test(values.apply)) throw new Error('Pass the preview fingerprint to --apply');
  const databasePath = await realpath(values.db);
  const handle = await open(databasePath, 'r');
  try {
    const header = Buffer.alloc(16);
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('Expected a regular SQLite file');
    await handle.read(header, 0, header.length, 0);
    if (header.toString('ascii') !== 'SQLite format 3\0') throw new Error('Expected an existing SQLite file');
  } finally { await handle.close(); }

  const databaseUrl = pathToFileURL(databasePath).href;
  process.env.DATABASE_URL = databaseUrl;
  process.env.ACG_PULSE_OFFLINE = '1';
  const [{ PrismaClient }, repair] = await Promise.all([
    import('@prisma/client'), import('../src/gamepulse/services/eventRepair.js')
  ]);
  const db = new PrismaClient({ datasourceUrl: databaseUrl });
  try {
    const files = await db.$queryRaw<Array<{ file: string }>>`PRAGMA database_list`;
    if (files.length !== 1 || await realpath(files[0].file) !== databasePath) throw new Error('Connection did not open the requested database');
    const result = values.apply
      ? await repair.applyEventRepair(db, scope, values.apply)
      : await repair.previewEventRepair(db, scope);
    console.log(JSON.stringify({ mode: values.apply ? 'applied' : 'preview', ...result }, null, 2));
  } finally { await db.$disconnect(); }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Event repair failed');
  process.exitCode = 1;
});
