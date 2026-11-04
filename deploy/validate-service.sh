#!/usr/bin/env bash
# ValidateService: the deployment succeeds only if /api/health answers {"ok":true}
# (which also proves the database opened and migrations applied). Otherwise the
# deployment fails and, with automatic rollback enabled, CodeDeploy restores the
# previous revision.
source "$(dirname "$0")/common.sh"
load_env

url="http://127.0.0.1:$PORT/api/health"
for attempt in $(seq 1 60); do
  if body="$(curl -fsS --max-time 5 "$url" 2>/dev/null)" && [[ "$body" == *'"ok":true'* ]]; then
    log "Healthy after $attempt attempt(s): $body"
    exit 0
  fi
  sleep 2
done

log "ERROR: $url did not become healthy. Recent service logs:"
journalctl -u "$SERVICE" -n 60 --no-pager || true
exit 1
