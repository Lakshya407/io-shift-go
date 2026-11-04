#!/usr/bin/env bash
# ApplicationStart: start (or restart) the service. Database migrations run
# automatically when the app opens the database.
source "$(dirname "$0")/common.sh"

systemctl enable "$SERVICE" >/dev/null 2>&1
systemctl restart "$SERVICE"
log "$SERVICE started"
