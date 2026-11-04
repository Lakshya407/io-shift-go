#!/usr/bin/env bash
# Called by systemd (ExecStartPost) after every start: the first request opens
# the database, applies migrations and starts the every-minute maintenance
# (SOS escalations, daily reports) even when nobody is using the app yet.
# Never fails the service.
port="${PORT:-3000}"
for _ in $(seq 1 30); do
  curl -fsS -o /dev/null --max-time 5 "http://127.0.0.1:$port/api/health" && exit 0
  sleep 1
done
echo "warmup: health check did not answer within 30s" >&2
exit 0
