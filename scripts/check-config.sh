#!/usr/bin/env bash
set -euo pipefail

# check-config.sh — Validate .env has all required variables before docker compose up.
# Usage: bash scripts/check-config.sh [path-to-env]
# Exit code 0 = all checks pass; non-zero = something is missing or insecure.

ENV_FILE="${1:-.env}"
ERRORS=0

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not found."
  echo "  Copy .env.production.example to .env and fill in the values."
  exit 1
fi

get_env_value() {
  local name="$1"
  awk -v key="$name" '
    /^[[:space:]]*(export[[:space:]]+)?[A-Za-z_][A-Za-z0-9_]*=/ {
      line=$0
      sub(/^[[:space:]]*export[[:space:]]+/, "", line)
      split(line, parts, "=")
      if (parts[1] == key) {
        sub(/^[^=]*=/, "", line)
        value=line
      }
    }
    END {
      sub(/\r$/, "", value)
      if ((substr(value, 1, 1) == "\"" && substr(value, length(value), 1) == "\"") ||
          (substr(value, 1, 1) == "'\''" && substr(value, length(value), 1) == "'\''")) {
        value=substr(value, 2, length(value) - 2)
      }
      print value
    }
  ' "$ENV_FILE"
}

check_var() {
  local name="$1"
  local value
  value="$(get_env_value "$name")"
  if [ -z "$value" ]; then
    echo "MISSING: $name is not set."
    ERRORS=$((ERRORS + 1))
  fi
}

check_not_default() {
  local name="$1"
  local default="$2"
  local value
  value="$(get_env_value "$name")"
  if [ "$value" = "$default" ]; then
    echo "INSECURE: $name is still set to the default value '$default'."
    ERRORS=$((ERRORS + 1))
  fi
}

check_min_length() {
  local name="$1"
  local min="$2"
  local value
  value="$(get_env_value "$name")"
  if [ -n "$value" ] && [ ${#value} -lt "$min" ]; then
    echo "WEAK: $name is ${#value} chars (minimum $min)."
    ERRORS=$((ERRORS + 1))
  fi
}

echo "=== ACG Pulse Configuration Check ==="
echo ""

# Required variables
check_var "ADMIN_PASSWORD"
check_not_default "ADMIN_PASSWORD" "change_me"
check_not_default "ADMIN_PASSWORD" "your_secure_password_here"

check_var "ADMIN_JWT_SECRET"
check_not_default "ADMIN_JWT_SECRET" "change_me_to_a_long_random_secret"
check_not_default "ADMIN_JWT_SECRET" "your_random_secret_here_at_least_32_chars"
check_min_length "ADMIN_JWT_SECRET" 32

check_var "CLIENT_URL"
CLIENT_URL_VALUE="$(get_env_value "CLIENT_URL")"
case "$CLIENT_URL_VALUE" in
  https://*) ;;
  "")
    ;;
  *)
    echo "INSECURE: CLIENT_URL must use the public HTTPS origin, not '$CLIENT_URL_VALUE'."
    ERRORS=$((ERRORS + 1))
    ;;
esac

check_var "TRUST_PROXY_HOPS"
TRUST_PROXY_VALUE="$(get_env_value "TRUST_PROXY_HOPS")"
case "$TRUST_PROXY_VALUE" in
  "") ;;
  *[!0-9]*|0)
    echo "INSECURE: TRUST_PROXY_HOPS must be a positive integer behind Caddy."
    ERRORS=$((ERRORS + 1))
    ;;
esac

# AI provider check
check_var "AI_PROVIDER"
AI_PROVIDER_VALUE="$(get_env_value "AI_PROVIDER")"
case "$AI_PROVIDER_VALUE" in
  openrouter) check_var "OPENROUTER_API_KEY" ;;
  deepseek)   check_var "DEEPSEEK_API_KEY" ;;
  mimo)       check_var "MIMO_API_KEY" ;;
  "")
    echo "WARNING: AI_PROVIDER is not set. Analysis features will not work."
    ;;
  *)
    echo "INVALID: Unknown AI_PROVIDER '${AI_PROVIDER_VALUE}'. Expected: openrouter, deepseek, or mimo."
    ERRORS=$((ERRORS + 1))
    ;;
esac

echo ""
if [ "$ERRORS" -gt 0 ]; then
  echo "Result: $ERRORS issue(s) found. Fix them before running docker compose up."
  exit 1
else
  echo "Result: All checks passed."
fi
