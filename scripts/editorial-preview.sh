#!/usr/bin/env bash
# Run a fixture-only copy, with a new temporary database on each launch.
set -euo pipefail
repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
port=${ACG_PULSE_PREVIEW_PORT:-3012}
[[ "$port" =~ ^[0-9]{4,5}$ ]] && ((10#$port >= 1024 && 10#$port <= 65535)) || {
  echo 'ACG_PULSE_PREVIEW_PORT must be between 1024 and 65535.' >&2; exit 2;
}
if [[ ! -x "$repo/server/node_modules/.bin/prisma" || ! -x "$repo/server/node_modules/.bin/tsx" || ! -x "$repo/client/node_modules/.bin/vite" ]]; then
  echo 'Install the locked dependencies once: (cd server && npm ci) && (cd client && npm ci)' >&2
  exit 2
fi
fixture=$(mktemp -d "${TMPDIR:-/tmp}/acg-editorial-preview.XXXXXXXX")
fixture=$(cd -- "$fixture" && pwd -P)
trap 'rm -rf -- "$fixture"' EXIT
mkdir -p "$fixture/server" "$fixture/client/dist" "$fixture/prisma" "$fixture/home"
cp "$repo/server/prisma/schema.prisma" "$fixture/prisma/schema.prisma"
cp -R "$repo/server/prisma/migrations" "$fixture/prisma/migrations"
touch "$fixture/empty.env"
origin="http://127.0.0.1:$port"
# Explicit environment: no API keys, CORS override, production URL or DB
# can follow the launcher from a developer terminal.
preview_env=(
  env -i "PATH=$PATH" "HOME=$fixture/home" "TMPDIR=$fixture"
  "DOTENV_CONFIG_PATH=$fixture/empty.env" "DATABASE_URL=file:$fixture/editorial-preview.db"
  "ACG_PULSE_PREVIEW_ROOT=$fixture" "ACG_PULSE_PREVIEW_ORIGIN=$origin"
  "ACG_PULSE_OFFLINE=1" "HOST=127.0.0.1" "PORT=$port" "CLIENT_URL=$origin"
  'ADMIN_PASSWORD=acg-editorial-fixture' 'ADMIN_JWT_SECRET=acg-editorial-fixture-secret-not-production'
  'CHECKPOINT_DISABLE=1' 'PRISMA_HIDE_UPDATE_MESSAGE=1'
)
# Run Prisma deploy away from checkout .env and prisma.config.
(cd "$fixture"; "${preview_env[@]}" "$repo/server/node_modules/.bin/prisma" migrate deploy --schema prisma/schema.prisma)
(cd "$repo/server"; "${preview_env[@]}" ./node_modules/.bin/prisma generate)
(cd "$repo/client"; "${preview_env[@]}" ./node_modules/.bin/tsc -b; "${preview_env[@]}" ./node_modules/.bin/vite build --outDir "$fixture/client/dist")
(cd "$fixture/server"; "${preview_env[@]}" node --import "$repo/server/node_modules/tsx/dist/loader.mjs" "$repo/server/scripts/editorial-preview.ts")
echo "隔离样本预览: $origin （Ctrl+C 退出；数据库随临时目录清理）"
(cd "$fixture/server"; "${preview_env[@]}" node --import "$repo/server/node_modules/tsx/dist/loader.mjs" "$repo/server/src/index.ts")
