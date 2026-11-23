"""Isolated regression checks for scripts/trial-db.py (no running service needed)."""

from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'scripts/trial-db.py'
DB_NAME = 'acg-pulse.db'
COOKIE = 'fixture-only-cookie-never-in-backups'
KEY = 'fixture-only-source-key-never-in-backups'


class TrialDBTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='acg-trial-test-')
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.trial = self.directory / '试 用'
        self.trial.mkdir()
        (self.trial / '.acg-pulse-trial').write_text('acg-pulse-trial-v1\n', encoding='utf-8')
        (self.trial / 'admin.env').write_text(f'ADMIN_PASSWORD={KEY}\n', encoding='utf-8')
        self.db = self.trial / DB_NAME
        self.env = {**os.environ, 'ACG_PULSE_TRIAL_DIR': str(self.trial)}
        with closing(sqlite3.connect(self.db)) as db:
            db.execute('CREATE TABLE _prisma_migrations (name TEXT)')
            for migration in sorted((ROOT / 'server/prisma/migrations').glob('*/migration.sql')):
                db.executescript(migration.read_text(encoding='utf-8'))
            db.execute('INSERT INTO "Event" (id, game) VALUES (?, ?)', ('evt-durable', '终末地'))
            config = json.dumps({'itemKind': 'official_post', 'apiKey': KEY, 'route': f'/demo?key={KEY}&safe=ok'})
            db.execute('''INSERT INTO "Source" (
                id, name, type, game, url, config, updatedAt, lastError
            ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)''',
                       ('source', '官方', 'rss', '终末地', f'https://user:{KEY}@example.net/feed', config, KEY))
            db.execute('INSERT INTO "Setting" (id, key, value) VALUES (?, ?, ?)', ('cookie', 'BILIBILI_COOKIE', COOKIE))
            db.execute('INSERT INTO "Setting" (id, key, value) VALUES (?, ?, ?)', ('bridge', 'persistent_event_legacy_bridge_v1', '1'))
            db.execute('''INSERT INTO "FeedItem" (
                id, sourceId, game, title, content, url, sourceType, identityKey, contentHash, eventId, updatedAt
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)''',
                       ('report', 'source', '终末地', '真实形态的测试标题', '完整的测试新闻',
                        f'https://example.net/read?token={KEY}&chapter=2', 'rss',
                        f'url:example.net/read?token={KEY}&chapter=2', 'fixture-hash', 'evt-durable'))
            db.execute('''INSERT INTO "DailyEdition" (date, status, health, updatedAt)
                          VALUES ('2026-11-20', 'published', '{}', CURRENT_TIMESTAMP)''')
            db.execute('''INSERT INTO "DailyEditionEntry" (
                editionDate, eventId, feedItemId, sourceId, rank, discoveredAt, story
            ) VALUES ('2026-11-20', 'evt-durable', 'report', 'source', 1, CURRENT_TIMESTAMP, ?)''',
                       (json.dumps({'canonicalTitle': '试用日报', 'sources': [
                           {'url': f'https://example.net/read?token={KEY}&chapter=2'}
                       ]}, ensure_ascii=False),))
            db.commit()

    def command(self, *args, code=0):
        run = subprocess.run([sys.executable, str(SCRIPT), *map(str, args)],
                             env=self.env, text=True, capture_output=True, timeout=15)
        self.assertEqual(run.returncode, code, run.stdout + run.stderr)
        self.assertNotIn(COOKIE, run.stdout + run.stderr)
        self.assertNotIn(KEY, run.stdout + run.stderr)
        return run

    def backup(self):
        self.command('backup')
        files = sorted((self.trial / 'backups').glob('trial-*.db'))
        self.assertEqual(len(files), 1)
        return files[0]

    def test_online_snapshot_includes_committed_wal_not_open_transaction(self):
        with closing(sqlite3.connect(self.db)) as writer:
            self.assertEqual(writer.execute('PRAGMA journal_mode=WAL').fetchone(), ('wal',))
            writer.execute('PRAGMA wal_autocheckpoint=0')
            writer.execute('UPDATE "FeedItem" SET title=?', ('WAL 已提交',))
            writer.commit()
            writer.execute('INSERT INTO "Event" (id, game) VALUES (?, ?)', ('uncommitted', '不应备份'))
            self.assertTrue(Path(str(self.db) + '-wal').exists())
            snapshot = self.backup()
            writer.rollback()
            self.assertEqual(writer.execute('SELECT value FROM "Setting" WHERE id=?', ('cookie',)).fetchone(), (COOKIE,))
        self.command('verify', snapshot)
        self.assertEqual((self.trial / 'admin.env').read_text(encoding='utf-8'), f'ADMIN_PASSWORD={KEY}\n')
        self.assertNotIn(COOKIE.encode(), snapshot.read_bytes())
        self.assertNotIn(KEY.encode(), snapshot.read_bytes())
        with closing(sqlite3.connect(snapshot)) as db:
            self.assertEqual(db.execute('SELECT id FROM "Event"').fetchall(), [('evt-durable',)])
            self.assertEqual(db.execute('SELECT title, url, identityKey FROM "FeedItem"').fetchone(),
                             ('WAL 已提交', 'https://example.net/read?chapter=2', None))
            self.assertEqual(db.execute('SELECT url, lastError FROM "Source"').fetchone(), ('https://example.net/feed', None))
            self.assertEqual(db.execute('SELECT key FROM "Setting"').fetchall(), [('persistent_event_legacy_bridge_v1',)])
            issue = json.loads(db.execute('SELECT story FROM "DailyEditionEntry"').fetchone()[0])
            self.assertEqual(issue['sources'][0]['url'], 'https://example.net/read?chapter=2')

    def test_isolated_restore_never_overwrites_target_or_accepts_bad_checksum(self):
        snapshot = self.backup()
        target = self.directory / 'restore rehearsal.db'
        self.command('restore', snapshot, '--to', target)
        with closing(sqlite3.connect(target)) as db:
            self.assertEqual(db.execute('SELECT date FROM "DailyEdition"').fetchone(), ('2026-11-20',))
        before = target.read_bytes()
        self.command('restore', snapshot, '--to', target, code=1)
        self.assertEqual(target.read_bytes(), before)
        self.command('restore', snapshot, '--to', self.db, code=1)
        digest_path = Path(str(snapshot) + '.sha256')
        digest_path.write_text('0' * 64 + '\n', encoding='ascii')
        self.command('verify', snapshot, code=1)
        self.command('restore', snapshot, code=1)
        self.assertFalse(list((self.trial / 'backups').glob('before-restore-*.db')))

    def test_in_place_restore_requires_stop_and_keeps_verified_rollback(self):
        snapshot = self.backup()
        with closing(sqlite3.connect(self.db)) as db:
            db.execute('UPDATE "FeedItem" SET title=?', ('快照之后的内容，回退时要保留',))
            db.commit()
        with self.subTest('instance or lifecycle PID blocks restore'):
            pid = self.trial / 'pid'
            pid.write_text(str(os.getpid()) + '\n', encoding='ascii')
            self.command('restore', snapshot, code=1)
            pid.unlink()
            lock = self.trial / 'lifecycle.lock'
            lock.mkdir()
            self.command('restore', snapshot, code=1)
            lock.rmdir()
        with self.subTest('sidecar blocks restore'):
            journal = Path(str(self.db) + '-wal')
            journal.touch()
            self.command('restore', snapshot, code=1)
            self.assertTrue(journal.exists())
            journal.unlink()
        before = snapshot.read_bytes()
        self.command('restore', snapshot)
        self.assertEqual(snapshot.read_bytes(), before)
        rollbacks = list((self.trial / 'backups').glob('before-restore-*.db'))
        self.assertEqual(len(rollbacks), 1)
        self.command('verify', rollbacks[0])
        with closing(sqlite3.connect(rollbacks[0])) as db:
            self.assertEqual(db.execute('SELECT title FROM "FeedItem"').fetchone()[0], '快照之后的内容，回退时要保留')
        with closing(sqlite3.connect(self.db)) as db:
            self.assertEqual(db.execute('SELECT title FROM "FeedItem"').fetchone()[0], '真实形态的测试标题')
        self.assertEqual(self.command('verify', snapshot).returncode, 0)
        self.assertEqual(hashlib.sha256(before).hexdigest(),
                         Path(str(snapshot) + '.sha256').read_text(encoding='ascii').strip())


if __name__ == '__main__':
    unittest.main()
