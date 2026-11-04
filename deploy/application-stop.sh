#!/usr/bin/env bash
# ApplicationStop: stop the running app so the database can be backed up cleanly.
# (CodeDeploy runs this script from the PREVIOUS revision; skipped on the first deployment.)
source "$(dirname "$0")/common.sh"

if systemctl list-unit-files "$SERVICE.service" >/dev/null 2>&1 && systemctl is-active --quiet "$SERVICE"; then
  log "Stopping $SERVICE"
  systemctl stop "$SERVICE"
else
  log "$SERVICE is not running"
fi
