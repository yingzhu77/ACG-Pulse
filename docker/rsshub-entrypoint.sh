#!/bin/sh
set -eu

HEADLESS_SHELL="/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell"
CHROME="/root/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome"

if [ ! -x "$HEADLESS_SHELL" ]; then
  playwright install chromium || true
fi

if [ ! -x "$HEADLESS_SHELL" ] && [ -x "$CHROME" ]; then
  mkdir -p "$(dirname "$HEADLESS_SHELL")"
  ln -sf "$CHROME" "$HEADLESS_SHELL"
fi

exec npm run start
