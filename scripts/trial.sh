#!/usr/bin/env bash
# Dedicated, loopback-only ACG Pulse private trial. Does not read checkout .env.
set -euo pipefail
umask 077
repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
dir=${ACG_PULSE_TRIAL_DIR:-"$repo/tmp/acg-pulse-trial"}
port=${ACG_PULSE_TRIAL_PORT:-3014}
collect=${ACG_PULSE_TRIAL_NETWORK:-0}
die() { echo "$*" >&2; exit 1; }
[[ "$dir" = /* && "$dir" != / && "$dir" != *[$'\n\r?#']* ]] || die 'ACG_PULSE_TRIAL_DIR must be an absolute path without ?, # or line breaks.'
[[ "$port" =~ ^[1-9][0-9]{3,4}$ ]] && (( port >= 1024 && port <= 65535 )) || die 'Invalid ACG_PULSE_TRIAL_PORT (1024–65535).'
[[ "$collect" == 0 || "$collect" == 1 ]] || die 'ACG_PULSE_TRIAL_NETWORK must be 0 or 1.'
origin="http://127.0.0.1:$port"
marker='acg-pulse-trial-v1'
verb=${1:-help}
if [[ "$verb" == help || "$verb" == --help ]]; then
  cat <<'USAGE'
Usage: bash scripts/trial.sh {prepare|start|foreground|stop|status|logs|access}
  prepare     Build current checkout and migrate dedicated trial DB while stopped
  start       Start saved/prepared release, detached when the host permits
  foreground  Start same release and keep it attached to this terminal
  stop        Graceful shutdown of the identified trial process only
  status      Show process and HTTP state
  logs        Show last 100 lines (current log; one rotated copy retained)
  access      Show browser address and admin.env location (not the password)
Options:
  ACG_PULSE_TRIAL_DIR    absolute persistent directory (default: repo/tmp/acg-pulse-trial)
  ACG_PULSE_TRIAL_PORT   loopback port (default: 3014)
  ACG_PULSE_TRIAL_NETWORK=1  explicitly enable collection; no sources or API keys are imported
USAGE
  exit 0
fi
[[ "$#" == 1 ]] || die 'Use trial.sh help.'
case "$verb" in prepare|start|foreground|stop|status|logs|access) ;; *) die 'Use trial.sh help.' ;; esac
[[ ! -L "$dir" ]] || die 'Trial directory cannot be a symlink.'
if [[ ! -e "$dir/.acg-pulse-trial" ]]; then
  case "$verb" in
    prepare|start|foreground)
      mkdir -p -- "$dir"
      [[ -z "$(ls -A -- "$dir")" ]] || die 'Refusing to initialize a nonempty directory without a private-trial marker.'
      printf '%s\n' "$marker" >"$dir/.acg-pulse-trial" ;;
    *) die 'Trial is not initialized. Run trial.sh prepare.' ;;
  esac
fi
dir=$(cd -- "$dir" && pwd -P)
[[ ! -L "$dir/.acg-pulse-trial" && "$(cat -- "$dir/.acg-pulse-trial")" == "$marker" ]] || die 'Invalid trial directory marker.'
for name in admin.env acg-pulse.db acg-pulse.db-wal acg-pulse.db-shm pid logs releases home active-release .ready-release empty.env lifecycle.lock; do
  [[ ! -L "$dir/$name" ]] || die "Unexpected symlink: $name"
done
for name in server.log server.log.1; do
  [[ ! -L "$dir/logs/$name" ]] || die "Unexpected log symlink: $name"
done
lock="$dir/lifecycle.lock"
releaseTmp=
lockHeld=0
unlock() {
  if [[ "$lockHeld" == 1 ]]; then
    rm -f -- "$lock/pid"
    rmdir -- "$lock"
    lockHeld=0
  fi
}
cleanup() {
  unlock
  [[ -z "$releaseTmp" ]] || rm -rf -- "$releaseTmp"
}
trap cleanup EXIT
acquire() {
  if ! mkdir -- "$lock" 2>/dev/null; then
    die "Trial lifecycle is locked: $lock. Wait for prepare/start/stop/restore to finish; inspect its pid before removing an abandoned lock."
  fi
  lockHeld=1
  printf '%s\n' "$$" >"$lock/pid"
}
pidFile="$dir/pid"
pid=''
owned_pid() {
  [[ -f "$pidFile" ]] || return 1
  read -r pid <"$pidFile" || return 1
  [[ "$pid" =~ ^[1-9][0-9]*$ ]] || return 1
  local args
  args=$(ps -ww -p "$pid" -o args=) || return 1
  [[ "$args" == *"/scripts/trial-serve.mjs $dir "* ]]
}
check_health() {
  ACG_TRIAL_HEALTH="$origin/api/health" node --input-type=module -e "
    fetch(process.env.ACG_TRIAL_HEALTH, { signal: AbortSignal.timeout(1000), redirect: 'error' })
      .then(async r => { if (!r.ok || (await r.json()).app !== 'game-pulse') process.exitCode = 1; })
      .catch(() => { process.exitCode = 1; });" >/dev/null 2>&1
}
check_port_free() {
  node --input-type=module -e "
    import net from 'node:net';
    const server = net.createServer();
    server.on('error', () => { process.exitCode = 1; });
    server.listen(Number(process.argv[1]), '127.0.0.1', () => server.close());" "$port"
}
build_env=()
setup_env() {
  command -v node >/dev/null || die 'Node is required.'
  mkdir -p -- "$dir/home" "$dir/logs" "$dir/releases"
  if [[ ! -e "$dir/admin.env" ]]; then
    node --input-type=module -e "
      import {randomBytes} from 'node:crypto';
      console.log('ADMIN_PASSWORD=' + randomBytes(24).toString('hex'));
      console.log('ADMIN_JWT_SECRET=' + randomBytes(48).toString('hex'));" >"$dir/admin.env"
  fi
  chmod 600 -- "$dir/admin.env"
  password=$(sed -n 's/^ADMIN_PASSWORD=//p' "$dir/admin.env")
  jwt=$(sed -n 's/^ADMIN_JWT_SECRET=//p' "$dir/admin.env")
  [[ "$password" =~ ^[0-9a-f]{48}$ && "$jwt" =~ ^[0-9a-f]{96}$ ]] || die 'Invalid generated trial admin.env; keep or replace with equivalent random hex values.'
  : >"$dir/empty.env"
  build_env=(env -i "PATH=$PATH" "HOME=$dir/home" "DATABASE_URL=file:$dir/acg-pulse.db"
    "DOTENV_CONFIG_PATH=$dir/empty.env" CHECKPOINT_DISABLE=1 PRISMA_HIDE_UPDATE_MESSAGE=1)
  runtime_env=("${build_env[@]}" "PORT=$port" "CLIENT_URL=$origin" ACG_PULSE_PRIVATE_TRIAL=1
    "ADMIN_PASSWORD=$password" "ADMIN_JWT_SECRET=$jwt")
  if [[ "$collect" == 0 ]]; then runtime_env+=(ACG_PULSE_OFFLINE=1); fi
}
prepare() {
  owned_pid && die 'Stop the private trial before preparing a new release.'
  [[ -x "$repo/server/node_modules/.bin/prisma" && -x "$repo/server/node_modules/.bin/tsc" && -x "$repo/client/node_modules/.bin/vite" ]] ||
    die 'Install locked packages first: (cd server && npm ci) && (cd client && npm ci)'
  releaseTmp=$(mktemp -d "$dir/releases/build.XXXXXXXX")
  mkdir -p -- "$releaseTmp/server" "$releaseTmp/client" "$releaseTmp/prisma"
  cp -- "$repo/server/prisma/schema.prisma" "$releaseTmp/prisma/schema.prisma"
  cp -R -- "$repo/server/prisma/migrations" "$releaseTmp/prisma/migrations"
  printf '%s\n' '{"type":"module","private":true}' >"$releaseTmp/server/package.json"
  ln -s -- "$repo/server/node_modules" "$releaseTmp/server/node_modules"
  (cd "$repo/server"; "${build_env[@]}" ./node_modules/.bin/prisma generate; "${build_env[@]}" ./node_modules/.bin/tsc --outDir "$releaseTmp/server/dist")
  (cd "$repo/client"; "${build_env[@]}" ./node_modules/.bin/tsc -b; "${build_env[@]}" ./node_modules/.bin/vite build --outDir "$releaseTmp/client/dist")
  (cd "$releaseTmp"; "${build_env[@]}" "$repo/server/node_modules/.bin/prisma" migrate deploy --schema prisma/schema.prisma)
  rm -f -- "$releaseTmp/prisma/schema.prisma"
  previous=$(cat -- "$dir/active-release" 2>/dev/null || true)
  printf '%s\n' "${releaseTmp##*/}" >"$dir/.ready-release"
  mv -f -- "$dir/.ready-release" "$dir/active-release"
  releaseTmp=''
  # Remove superseded generated build output, never the SQLite database or backups.
  if [[ "$previous" =~ ^build\.[A-Za-z0-9]{8}$ && ! -L "$dir/releases/$previous" ]]; then
    rm -rf -- "$dir/releases/$previous"
  fi
  printf 'Prepared private trial. Database: %s\n' "$dir/acg-pulse.db"
}
run() {
  owned_pid && die "Trial already running (PID $pid)."
  check_port_free || die "Loopback port $port is in use; choose another ACG_PULSE_TRIAL_PORT."
  [[ -f "$dir/active-release" ]] || prepare
  release=$(cat -- "$dir/active-release")
  [[ "$release" =~ ^build\.[A-Za-z0-9]{8}$ && -f "$dir/releases/$release/server/dist/index.js" ]] ||
    die 'Prepared release not found; run trial.sh prepare.'
  release="$dir/releases/$release"
  if [[ "$verb" == foreground ]]; then
    "${runtime_env[@]}" node "$repo/scripts/trial-serve.mjs" "$dir" "$release" foreground < /dev/null &
  else
    nohup "${runtime_env[@]}" node "$repo/scripts/trial-serve.mjs" "$dir" "$release" background </dev/null >/dev/null 2>&1 &
  fi
  supervisor=$!
  printf '%s\n' "$supervisor" >"$pidFile"
  if [[ "$verb" == foreground ]]; then
    trap 'kill -TERM "$supervisor" 2>/dev/null || true; wait "$supervisor" 2>/dev/null || true; exit 130' INT TERM
  fi
  # Wait for this process and the exact service to be ready (not only a bound port).
  for (( i=0; i < 24; i++ )); do
    if ! kill -0 "$supervisor" 2>/dev/null; then
      rm -f -- "$pidFile"
      die 'Trial exited during startup. Run trial.sh logs.'
    fi
    if check_health; then
      unlock
      printf 'Private trial: %s (network collection: %s)\n' "$origin" "$collect"
      if [[ "$verb" == foreground ]]; then wait "$supervisor"; fi
      return
    fi
    sleep .5
  done
  owned_pid && kill -TERM "$pid" || true
  die 'Trial did not become healthy. Run trial.sh logs.'
}
case "$verb" in
  prepare) acquire; setup_env; prepare ;;
  start|foreground) acquire; setup_env; run ;;
  stop)
    acquire
    if owned_pid; then
      kill -TERM "$pid"
      for (( i=0; i < 40; i++ )); do
        if ! owned_pid; then break; fi
        sleep .25
      done
      ! owned_pid || die "Trial PID $pid did not stop; no forced kill performed."
    fi
    rm -f -- "$pidFile"
    echo 'Trial stopped.' ;;
  status)
    if owned_pid; then
      if check_health; then printf 'Healthy at %s (PID %s)\n' "$origin" "$pid"; else die "Trial process $pid is live; HTTP unavailable at $origin."; fi
    else
      echo 'Trial is stopped. Run trial.sh start or trial.sh foreground.'
    fi ;;
  logs)
    [[ -f "$dir/logs/server.log" ]] || die 'No trial logs yet.'
    tail -n 100 -- "$dir/logs/server.log" ;;
  access)
    printf 'On this computer: %s\nAdmin password: ADMIN_PASSWORD in %s (keep private).\n' "$origin" "$dir/admin.env" ;;
esac
