#!/bin/sh
set -e

cd /app/server

DB_PATH="${DATABASE_URL#file:}"
BACKUP_DIR="$(dirname "$DB_PATH")/pre-migrate-backups"
BASELINE_MIGRATION="20260706000000_baseline"

# Prisma does not model the rebuildable FTS5 virtual table. Back up the
# canonical database, then remove only that index before schema synchronization.
if [ -f "$DB_PATH" ]; then
  mkdir -p "$BACKUP_DIR"
  BACKUP_PATH="$BACKUP_DIR/prod_pre_migrate_$(date +%Y%m%d_%H%M%S).db"
  echo "Creating pre-migration backup: $BACKUP_PATH"
  sqlite3 "$DB_PATH" ".backup '$BACKUP_PATH'"
  sqlite3 "$BACKUP_PATH" "PRAGMA quick_check;" | grep -qx "ok"
  sha256sum "$BACKUP_PATH" > "$BACKUP_PATH.sha256"

  echo "Removing rebuildable FTS5 index before Prisma schema sync..."
  sqlite3 "$DB_PATH" <<'SQL'
DROP TRIGGER IF EXISTS FeedItem_ai;
DROP TRIGGER IF EXISTS FeedItem_ad;
DROP TRIGGER IF EXISTS FeedItem_au;
DROP TABLE IF EXISTS FeedItemFTS;
SQL

  # Keep the five most recent pre-migration backups in the persistent volume.
  # Generated names contain only timestamps.
  # shellcheck disable=SC2012
  ls -1t "$BACKUP_DIR"/prod_pre_migrate_*.db 2>/dev/null | tail -n +6 | while read -r old; do
    rm -f "$old" "$old.sha256"
  done
fi

echo "Deploying database migrations..."
npx prisma generate
if [ -f "$DB_PATH" ]; then
  HAS_MIGRATIONS_TABLE="$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='_prisma_migrations';")"
  USER_TABLE_COUNT="$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> '_prisma_migrations';")"

  if [ "$HAS_MIGRATIONS_TABLE" = "0" ] && [ "$USER_TABLE_COUNT" != "0" ]; then
    echo "Existing database has no Prisma migration history; marking baseline as applied..."
    npx prisma migrate resolve --applied "$BASELINE_MIGRATION"
  fi
fi
npx prisma migrate deploy

# Start the server
echo "Starting Game Pulse server..."
exec node dist/index.js
