#!/usr/bin/env bash
# AfterInstall: copy the new build into its own release folder, point "current"
# at it, install the systemd unit, and prune old releases.
source "$(dirname "$0")/common.sh"
load_env

release_id="${DEPLOYMENT_ID:-manual-$(date -u +%Y%m%dT%H%M%SZ)}"
release="$RELEASES/$release_id"

if [[ ! -f "$STAGING/app/server.js" ]]; then
  log "ERROR: $STAGING/app/server.js not found — the revision is incomplete."
  exit 1
fi

log "Installing release $release_id"
rm -rf "$release"
mkdir -p "$release"
cp -a "$STAGING/app/." "$release/"
chown -R root:root "$release"
chmod -R u=rwX,go=rX "$release"

# Atomic switch of the "current" symlink.
ln -sfn "$release" "$APP_ROOT/current.next"
mv -Tf "$APP_ROOT/current.next" "$CURRENT"

# Helper scripts and systemd unit.
install -d -m 755 "$APP_ROOT/bin"
install -m 755 "$STAGING/deploy/warmup.sh" "$APP_ROOT/bin/warmup.sh"
install -m 644 "$STAGING/deploy/shiftgo.service" "/etc/systemd/system/$SERVICE.service"
systemctl daemon-reload

# Keep the newest releases only (the live one is always the newest).
ls -1dt "$RELEASES"/*/ 2>/dev/null | tail -n +$((KEEP_RELEASES + 1)) | xargs -r rm -rf || true
log "Live release: $(readlink -f "$CURRENT") (revision $(cat "$CURRENT/REVISION" 2>/dev/null || echo unknown))"
