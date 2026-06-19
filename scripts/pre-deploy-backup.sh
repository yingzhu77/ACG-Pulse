#!/bin/bash
# Create a consistent host-side backup immediately before replacing the app container.

set -euo pipefail

CONTAINER="${1:-game-pulse}"
BACKUP_DIR="${2:-./backups}"
DB_PATH="/app/server/data/prod.db"

if ! docker inspect "$CONTAINER" >/dev/null 2>&1; then
  echo "[pre-deploy] No existing app container; skipping database backup"
  exit 0
fi

mkdir -p "$BACKUP_DIR"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="$BACKUP_DIR/prod_pre_deploy_${TIMESTAMP}.db"
WAS_RUNNING=$(docker inspect -f '{{.State.Running}}' "$CONTAINER")

restart_on_error() {
  if [ "$WAS_RUNNING" = "true" ]; then
    docker start "$CONTAINER" >/dev/null 2>&1 || true
  fi
}
trap restart_on_error ERR

if [ "$WAS_RUNNING" = "true" ]; then
  echo "[pre-deploy] Stopping app for a consistent database snapshot..."
  docker stop "$CONTAINER" >/dev/null
fi

docker cp "$CONTAINER:$DB_PATH" "$BACKUP_FILE"
sha256sum "$BACKUP_FILE" > "$BACKUP_FILE.sha256"
trap - ERR

echo "[pre-deploy] Backup created: $BACKUP_FILE"
echo "[pre-deploy] App remains stopped and must be started by the deployment command"
