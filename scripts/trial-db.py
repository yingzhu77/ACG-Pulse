#!/usr/bin/env python3
"""Consistent data-only snapshots for the local ACG-Pulse private trial."""

import argparse
from contextlib import closing, contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import sys
import tempfile
import time
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from uuid import uuid4


ROOT = Path(__file__).resolve().parent.parent
TRIAL_MARKER = '.acg-pulse-trial'
TRIAL_MARKER_VALUE = 'acg-pulse-trial-v1'
DB_NAME = 'acg-pulse.db'
PID_NAME = 'pid'
LOCK_NAME = 'lifecycle.lock'
DB_TABLES = {
    '_prisma_migrations', 'FeedItem', 'Source', 'SourceHealthLog', 'Setting', 'Event',
    'DailyEdition', 'DailyEditionEntry', 'Analysis', 'AnalysisTask', 'CommunityTopic',
}
KEEP_SETTINGS = ('persistent_event_legacy_bridge_v1',)
SENSITIVE_PARTS = ('secret', 'password', 'credential', 'cookie', 'authorization', 'token', 'apikey', 'sessdata')
PRIVATE_QUERY_KEYS = {'key', 'pwd', 'auth', 'accesskey', 'sessionid', 'sid', 'sig', 'signature'}
SOURCE_CONFIG_FIELDS = {
    'itemKind', 'route', 'routeFallbacks', 'rssHubRoutes', 'rssHubBaseUrls', 'fetchTimeoutMs',
    'directApiFallback', 'includeDynamic', 'tags', 'authorUrl', 'articleSelector', 'titleSelector',
    'linkSelector', 'dateSelector', 'urlPattern',
}
SIDECARS = ('-wal', '-shm', '-journal')


class TrialDBError(Exception):
    pass


def trial_directory() -> Path:
    configured = os.environ.get('ACG_PULSE_TRIAL_DIR')
    trial = Path(configured).expanduser() if configured else ROOT / 'tmp/acg-pulse-trial'
    if not trial.is_absolute():
        raise TrialDBError('ACG_PULSE_TRIAL_DIR 必须是绝对路径。')
    if trial.is_symlink():
        raise TrialDBError('试用目录不能是符号链接。')
    trial = trial.resolve()
    marker = trial / TRIAL_MARKER
    if marker.is_symlink() or not marker.is_file() or marker.read_text(encoding='utf-8').strip() != TRIAL_MARKER_VALUE:
        raise TrialDBError('未找到有效的私有试用实例标记；请先通过 scripts/trial.sh 初始化。')
    return trial


def exists_including_link(path: Path) -> bool:
    return path.exists() or path.is_symlink()


def sqlite_file(path: Path) -> None:
    if path.is_symlink() or not path.is_file():
        raise TrialDBError('数据库文件不存在、不是普通文件或是符号链接。')


def checksum_path(path: Path) -> Path:
    return path.with_name(path.name + '.sha256')


def digest(path: Path) -> str:
    hash_value = hashlib.sha256()
    with path.open('rb') as file:
        for block in iter(lambda: file.read(1024 * 1024), b''):
            hash_value.update(block)
    return hash_value.hexdigest()


def sqlite_ro(path: Path) -> sqlite3.Connection:
    sqlite_file(path)
    return sqlite3.connect(f'{path.absolute().as_uri()}?mode=ro', uri=True, timeout=3)


def flush_file(path: Path) -> None:
    with path.open('rb') as handle:
        os.fsync(handle.fileno())


def verify_db(path: Path) -> None:
    with closing(sqlite_ro(path)) as db:
        if db.execute('PRAGMA integrity_check').fetchall() != [('ok',)]:
            raise TrialDBError('SQLite 完整性检查失败。')
        if db.execute('PRAGMA foreign_key_check').fetchone():
            raise TrialDBError('SQLite 外键检查失败。')
        tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
        if not DB_TABLES <= tables:
            raise TrialDBError('不是支持的 ACG-Pulse 私有试用数据库。')


def verify_snapshot(path: Path) -> str:
    sqlite_file(path)
    sidecar = checksum_path(path)
    if sidecar.is_symlink() or not sidecar.is_file() or sidecar.stat().st_size > 100:
        raise TrialDBError('缺少有效的 .sha256 校验文件；不会跳过校验。')
    expected = sidecar.read_text(encoding='ascii').strip()
    if not re.fullmatch(r'[0-9a-f]{64}', expected) or expected != digest(path):
        raise TrialDBError('SHA-256 校验失败，不会使用此备份。')
    if has_sidecars(path):
        raise TrialDBError('备份存在 WAL/SHM/journal 旁路文件；不是独立快照。')
    verify_db(path)
    return expected


def sensitive_key(key: str) -> bool:
    key = re.sub(r'[^a-z0-9]', '', key.lower())
    return key in PRIVATE_QUERY_KEYS or any(part in key for part in SENSITIVE_PARTS)


def scrub_locator(value):
    if not isinstance(value, str) or not value:
        return value
    try:
        url = urlsplit(value)
        if url.username is not None:
            url = url._replace(netloc=url.netloc.rsplit('@', 1)[-1])
        if not url.query:
            return url.geturl()
        query = parse_qsl(url.query, keep_blank_values=True)
        safe = [(key, part) for key, part in query if not sensitive_key(key)]
        return urlunsplit(url._replace(query=urlencode(safe))) if safe != query else url.geturl()
    except (TypeError, ValueError):
        # Do not retain a malformed or unsafe custom locator.
        return None


def scrub_config(value):
    if isinstance(value, dict):
        return {key: scrub_config(part) for key, part in value.items() if not sensitive_key(key)}
    if isinstance(value, list):
        return [scrub_config(part) for part in value]
    if isinstance(value, str) and ('://' in value or '?' in value):
        return scrub_locator(value)
    return value


def scrub_story(value):
    if isinstance(value, dict):
        return {
            key: scrub_locator(part) if key.lower() in {'url', 'authorurl', 'coverurl', 'href'} else scrub_story(part)
            for key, part in value.items() if not sensitive_key(key)
        }
    if isinstance(value, list):
        return [scrub_story(part) for part in value]
    return value


def sanitize_snapshot(db: sqlite3.Connection) -> None:
    # The app's only editable Setting is a Bilibili cookie. Preserve the safe
    # legacy-bridge marker; all other settings (incl. transient community state)
    # may be rebuilt and are not necessary to restore reading history.
    db.execute('PRAGMA secure_delete = ON')
    db.execute('DELETE FROM "Setting" WHERE "key" NOT IN (?)', KEEP_SETTINGS)
    for source_id, url, route, config in db.execute('SELECT id, url, route, config FROM "Source"').fetchall():
        try:
            decoded = json.loads(config) if config else None
            safe_config = json.dumps(scrub_config({k: v for k, v in decoded.items() if k in SOURCE_CONFIG_FIELDS}),
                                     ensure_ascii=False) if isinstance(decoded, dict) else None
        except (TypeError, ValueError):
            safe_config = None
        db.execute('UPDATE "Source" SET url=?, route=?, config=?, lastError=NULL WHERE id=?',
                   (scrub_locator(url), scrub_locator(route), safe_config, source_id))
    for item_id, url, author, cover, external, identity in db.execute(
        'SELECT id, url, authorUrl, coverUrl, externalId, identityKey FROM "FeedItem"'
    ).fetchall():
        safe_url, safe_author, safe_cover = map(scrub_locator, (url, author, cover))
        safe_external = scrub_locator(external) if isinstance(external, str) and '://' in external else external
        safe_identity = identity
        if isinstance(identity, str) and identity.startswith('url:'):
            locator = identity.removeprefix('url:')
            # The identity key stores a host/path/query without scheme.
            if scrub_locator('https://' + locator) != 'https://' + locator:
                safe_identity = None
        if (safe_url, safe_author, safe_cover, safe_external, safe_identity) != (url, author, cover, external, identity):
            db.execute('UPDATE "FeedItem" SET url=?, authorUrl=?, coverUrl=?, externalId=?, identityKey=? WHERE id=?',
                       (safe_url or '', safe_author, safe_cover, safe_external, safe_identity, item_id))
    for topic_id, url in db.execute('SELECT id, url FROM "CommunityTopic"').fetchall():
        safe_url = scrub_locator(url)
        if safe_url != url:
            db.execute('UPDATE "CommunityTopic" SET url=? WHERE id=?', (safe_url or '', topic_id))
    for issue, event, story, correction in db.execute(
        'SELECT editionDate, eventId, story, correction FROM "DailyEditionEntry"'
    ).fetchall():
        # Public story fields are preserved; only credential-shaped JSON keys or
        # URLs inside snapshot/correction payloads are redacted.
        payload = json.loads(story)
        note = json.loads(correction) if correction else None
        safe_payload, safe_note = scrub_story(payload), scrub_story(note)
        if safe_payload != payload or safe_note != note:
            db.execute('UPDATE "DailyEditionEntry" SET story=?, correction=? WHERE editionDate=? AND eventId=?',
                       (json.dumps(safe_payload, ensure_ascii=False),
                        json.dumps(safe_note, ensure_ascii=False) if safe_note is not None else None,
                        issue, event))
    # Upstream error diagnostics can contain URLs or provider messages.
    # Keep timestamps, states and counts, not error messages in the portable backup.
    db.execute('UPDATE "SourceHealthLog" SET error=NULL WHERE error IS NOT NULL')
    db.execute('UPDATE "Analysis" SET error=NULL WHERE error IS NOT NULL')
    db.execute('UPDATE "AnalysisTask" SET lastError=NULL WHERE lastError IS NOT NULL')
    db.commit()
    db.execute('VACUUM')


def snapshot(source: Path, dest: Path) -> None:
    deadline = time.monotonic() + 30

    def progress(_status: int, _remaining: int, _total: int) -> None:
        if time.monotonic() >= deadline:
            raise TrialDBError('SQLite 快照超时，未发布不完整的备份。')

    with closing(sqlite_ro(source)) as src, closing(sqlite3.connect(dest, timeout=3)) as db:
        src.backup(db, pages=256, progress=progress, sleep=0.05)
        if db.execute('PRAGMA journal_mode = DELETE').fetchone() != ('delete',):
            raise TrialDBError('无法把快照转换为独立的 SQLite 文件。')
        sanitize_snapshot(db)
    os.chmod(dest, 0o600)
    verify_db(dest)
    flush_file(dest)


def write_snapshot(source: Path, directory: Path, prefix: str) -> Path:
    if directory.is_symlink():
        raise TrialDBError('备份目录不能是符号链接。')
    directory.mkdir(mode=0o700, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    name = f'{prefix}-{stamp}-{uuid4().hex[:12]}.db'
    final = directory / name
    with tempfile.TemporaryDirectory(dir=directory, prefix='.trial-stage-') as temporary:
        stage = Path(temporary) / name
        snapshot(source, stage)
        sidecar = checksum_path(stage)
        sidecar.write_text(digest(stage) + '\n', encoding='ascii')
        os.chmod(sidecar, 0o600)
        flush_file(sidecar)
        # Publish complete files only, never overwrite an existing snapshot.
        os.link(stage, final)
        try:
            os.link(sidecar, checksum_path(final))
        except FileExistsError as error:
            raise TrialDBError('校验文件名意外重复；未覆盖已有文件。') from error
    return final


def has_sidecars(path: Path) -> bool:
    return any(exists_including_link(Path(str(path) + suffix)) for suffix in SIDECARS)


@contextmanager
def stopped_trial(directory: Path):
    lock = directory / LOCK_NAME
    try:
        lock.mkdir(mode=0o700)
    except FileExistsError as error:
        raise TrialDBError('试用实例正在启动、停止或恢复；如锁残留，先核实没有进程。') from error
    owner = lock / PID_NAME
    try:
        owner.write_text(f'{os.getpid()}\n', encoding='ascii')
        if exists_including_link(directory / PID_NAME):
            raise TrialDBError('试用进程记录仍存在，请先运行 bash scripts/trial.sh stop。')
        if has_sidecars(directory / DB_NAME):
            raise TrialDBError('试用数据库仍有 WAL/SHM/journal；请先确认已正常停服，不要手动删除它们。')
        yield
    finally:
        owner.unlink(missing_ok=True)
        lock.rmdir()


def restore(source: Path, separate: Path | None) -> None:
    expected = verify_snapshot(source)
    if separate is not None:
        directory = separate.parent
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        configured = os.environ.get('ACG_PULSE_TRIAL_DIR')
        active = (Path(configured).expanduser() if configured else ROOT / 'tmp/acg-pulse-trial') / DB_NAME
        if separate.resolve() == active.resolve() or exists_including_link(separate) or has_sidecars(separate):
            raise TrialDBError('--to 需要与运行实例分离、且从未使用的目标文件。')
        with tempfile.TemporaryDirectory(dir=directory, prefix='.trial-restore-') as temporary:
            candidate = Path(temporary) / DB_NAME
            snapshot(source, candidate)
            if verify_snapshot(source) != expected:
                raise TrialDBError('恢复期间源备份发生变化。')
            os.link(candidate, separate)
        print(f'已恢复到独立文件：{separate}')
        return

    directory = trial_directory()
    dest = directory / DB_NAME
    with stopped_trial(directory):
        sqlite_file(dest)
        with tempfile.TemporaryDirectory(dir=directory, prefix='.trial-restore-') as temporary:
            candidate = Path(temporary) / DB_NAME
            snapshot(source, candidate)
            if verify_snapshot(source) != expected:
                raise TrialDBError('恢复期间源备份发生变化。')
            rollback = write_snapshot(dest, directory / 'backups', 'before-restore')
            verify_snapshot(rollback)
            if has_sidecars(dest):
                raise TrialDBError('恢复前发现数据库旁路文件，未修改现有数据库。')
            os.replace(candidate, dest)
        verify_db(dest)
        print(f'已恢复试用库：{dest}')
        print(f'回退快照：{rollback}')
        print('保持停服；检查后须手动运行 bash scripts/trial.sh start。')


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='action', required=True)
    commands.add_parser('backup', help='对运行中或停止的试用实例做一致性快照')
    verify = commands.add_parser('verify', help='验证快照校验和与 SQLite 完整性')
    verify.add_argument('snapshot', type=Path)
    recover = commands.add_parser('restore', help='恢复停止的试用库或创建独立恢复演练文件')
    recover.add_argument('snapshot', type=Path)
    recover.add_argument('--to', type=Path, help='独立恢复演练目标（要求文件不存在）')
    args = parser.parse_args()

    try:
        if args.action == 'backup':
            trial = trial_directory()
            result = write_snapshot(trial / DB_NAME, trial / 'backups', 'trial')
            verify_snapshot(result)
            print(f'已创建并验证快照：{result}')
        elif args.action == 'verify':
            verify_snapshot(args.snapshot)
            print(f'校验和、SQLite 完整性与外键检查通过：{args.snapshot}')
        else:
            restore(args.snapshot, args.to)
        return 0
    except TrialDBError as error:
        print(f'试用数据库操作停止：{error}', file=sys.stderr)
    except (OSError, ValueError, sqlite3.Error) as error:
        # Do not print a database value, locator or interpolated SQLite error.
        print(f'试用数据库操作失败（{type(error).__name__}）。请检查文件权限、磁盘空间和实例状态。', file=sys.stderr)
    return 1


if __name__ == '__main__':
    raise SystemExit(main())
