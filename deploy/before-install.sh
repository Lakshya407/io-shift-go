#!/usr/bin/env bash
# BeforeInstall: check prerequisites, prepare folders, back up the database.
source "$(dirname "$0")/common.sh"
load_env

# --- prerequisites ---------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  log "ERROR: Node.js is not installed (need >= 22.13). See docs/DEPLOY-AWS.md."
  exit 1
fi
if ! node -e "require('node:sqlite')" >/dev/null 2>&1; then
  log "ERROR: $(node -v) has no node:sqlite module. Install Node.js 22.13 or newer."
  exit 1
fi

# --- service user and folders ---------------------------------------------
if ! id "$APP_USER" >/dev/null 2>&1; then
  log "Creating system user $APP_USER"
  useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin "$APP_USER"
fi
mkdir -p "$RELEASES" "$DATA_DIR/backups" "$(dirname "$DATABASE_PATH")"
chown "$APP_USER:$APP_USER" "$DATA_DIR" "$DATA_DIR/backups" "$(dirname "$DATABASE_PATH")"
chmod 750 "$DATA_DIR"
chmod 600 "$ENV_FILE"

# Remove the previous staging copy so deleted files do not linger.
rm -rf "$STAGING"

# --- database backup ---------------------------------------------------------
if [[ -f "$DATABASE_PATH" ]]; then
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  target="$DATA_DIR/backups/shiftgo-$stamp.db"
  if command -v sqlite3 >/dev/null 2>&1; then
    sqlite3 "$DATABASE_PATH" ".backup '$target'"
  else
    # App is stopped (ApplicationStop), so copying the files together is consistent.
    cp -a "$DATABASE_PATH" "$target"
    for ext in -wal -shm; do
      if [[ -f "$DATABASE_PATH$ext" ]]; then cp -a "$DATABASE_PATH$ext" "$target$ext"; fi
    done
  fi
  gzip -f "$target"
  log "Database backed up to $target.gz"

  if [[ -n "${BACKUP_S3_URI:-}" ]] && command -v aws >/dev/null 2>&1; then
    if aws s3 cp "$target.gz" "${BACKUP_S3_URI%/}/deploy/shiftgo-$stamp.db.gz" --only-show-errors; then
      log "Backup uploaded to ${BACKUP_S3_URI%/}/deploy/"
    else
      log "WARNING: S3 upload failed; the local backup is kept."
    fi
  fi

  # Keep only the newest local backups.
  ls -1t "$DATA_DIR"/backups/shiftgo-*.db.gz 2>/dev/null | tail -n +$((KEEP_LOCAL_BACKUPS + 1)) | xargs -r rm -f || true
  chown -R "$APP_USER:$APP_USER" "$DATA_DIR/backups"
else
  log "No database yet (first deployment); nothing to back up."
fi
