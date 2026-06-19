#!/bin/sh
set -e

cd /app/server

DB_PATH="${DATABASE_URL#file:}"
BACKUP_DIR="$(dirname "$DB_PATH")/pre-migrate-backups"

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

echo "Synchronizing database schema..."
npx prisma generate
npx prisma db push --skip-generate

# Start the server
echo "Starting Game Pulse server..."
exec node dist/index.js
