#!/usr/bin/env bash
# Shared settings for the CodeDeploy hook scripts. Sourced, not executed.
set -euo pipefail

APP_ROOT=/opt/shiftgo
STAGING="$APP_ROOT/staging"
RELEASES="$APP_ROOT/releases"
CURRENT="$APP_ROOT/current"
DATA_DIR=/var/lib/shiftgo
ENV_FILE=/etc/shiftgo.env
SERVICE=shiftgo
APP_USER=shiftgo
KEEP_RELEASES=3
KEEP_LOCAL_BACKUPS=14

log() { echo "[shiftgo-deploy] $*"; }

load_env() {
  if [[ ! -f "$ENV_FILE" ]]; then
    log "ERROR: $ENV_FILE is missing. Create it from deploy/shiftgo.env.example before the first deployment."
    exit 1
  fi
  # Read only the keys the scripts need; the file is not sourced, so secrets
  # containing $, quotes or spaces are never interpreted by the shell.
  PORT="$(env_value PORT)"; PORT="${PORT:-3000}"
  DATABASE_PATH="$(env_value DATABASE_PATH)"; DATABASE_PATH="${DATABASE_PATH:-$DATA_DIR/shiftgo.db}"
  BACKUP_S3_URI="$(env_value BACKUP_S3_URI)"
}

# Value of KEY from the env file (last occurrence, surrounding quotes removed).
env_value() {
  { grep -E "^[[:space:]]*$1=" "$ENV_FILE" || true; } | tail -n 1 | sed -E -e "s/^[[:space:]]*$1=//" -e 's/^"(.*)"$/\1/' -e "s/^'(.*)'\$/\1/"
}
