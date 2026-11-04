# Running ShiftGo with Docker

```
Browser ─HTTPS─▶ TLS (LB / ingress) ─▶ proxy (Nginx :8088) ─▶ app (Node.js :3000) ─▶ postgres (:5432, internal)
                                                                  └─ every minute: SOS escalation + daily reports (in-process)
optional (--profile automation):  n8n :5678  ◀──▶  app   (Teams / email delivery)
```

The image uses the self-hosted Node.js build (`npm run build:node`, `lib/node-runtime.ts`).
With `DATABASE_URL` set it uses **PostgreSQL** (`lib/postgres.ts`, schema in `db/migrations-pg/`).
Without it, it falls back to a local SQLite file, which the AWS EC2 path still uses. Migrations run automatically at start.

| File | Purpose |
|---|---|
| `Dockerfile` | Multi-stage build: `deps` → `build` → `test` (optional) → `runtime` (non-root, health check) |
| `docker-compose.yml` | `postgres` + `app` + `proxy` (Nginx); `n8n` behind the `automation` profile |
| `docker/nginx.conf` | Reverse proxy: forwards `Host`, `X-Forwarded-Proto` and `X-Real-IP` to the app |
| `.env.example` | Every setting, documented. Copy it to `.env` (git-ignored) and fill it in |
| `db/migrations-pg/` | PostgreSQL schema migrations (`drizzle/` holds the SQLite/D1 equivalents) |

## Quick start

Requires Docker 24+ with Compose v2.24 or newer.

```bash
cp .env.example .env                 # fill in the values (see below)
docker compose up -d --build         # first build takes ~5–10 min
docker compose ps                    # postgres + app "healthy", proxy "Up"
```

Open <http://localhost:8088> locally, or `https://iocab.shiftgo.infoapps.io` once TLS is in front.
Enter `SETUP_TOKEN` as the *Setup key* to create the first administrator.

## Configuration (`.env`)

Everything is in **one file**, `.env`. Nothing in it is needed to *build* or *test* the image, only
to *run* it. In GitLab, store each key as a CI/CD variable (secrets: *Masked* + *Protected*), or as a
Kubernetes Secret/ConfigMap for Argo CD.

| Variable | Secret | Required | Notes |
|---|---|---|---|
| `SITE_URL` | | yes | `https://iocab.shiftgo.infoapps.io` |
| `SETUP_TOKEN` | ✔ | yes | `openssl rand -hex 32`. One-time key for the first admin |
| `POSTGRES_USER` / `POSTGRES_DB` | | compose | default `shiftgo` / `shiftgo` |
| `POSTGRES_PASSWORD` | ✔ | compose | letters/digits only (it goes into a URL) |
| `DATABASE_URL` | ✔ | k8s / managed DB | `postgres://user:pass@host:5432/db`; empty with compose |
| `DATABASE_SSL` | | | `require` for managed cloud Postgres |
| `AZURE_AD_TENANT_ID` / `AZURE_AD_CLIENT_ID` | | for SSO | from the app registration *Overview* |
| `AZURE_AD_CLIENT_SECRET` | ✔ | for SSO | *Certificates & secrets* → secret **Value** |
| `AZURE_AD_REDIRECT_URI` | | | `https://iocab.shiftgo.infoapps.io/api/auth/sso/callback` |
| `AUTOMATION_API_KEY`, `N8N_WEBHOOK_SECRET` | ✔ | n8n only | random, ≥ 20 chars |
| `N8N_WEBHOOK_URL` | | n8n only | |
| `SHIFTGO_HTTP_PORT` | | | host port of the proxy (default `8088`) |

Compose sets `HOST`, `PORT`, `NODE_ENV`, `VINEXT_TRUST_PROXY=1` and builds `DATABASE_URL` from the
`POSTGRES_*` values. After editing `.env`: `docker compose up -d`.

## Microsoft sign-in (Entra ID app registration)

| Setting (Entra admin center → App registrations → *your app*) | Value |
|---|---|
| Authentication → Add a platform → **Web** → Redirect URI | `https://iocab.shiftgo.infoapps.io/api/auth/sso/callback` |
| Authentication → Front-channel logout URL | leave **empty** (see below) |
| Authentication → Implicit grant (access / ID tokens) | leave **unchecked** (the app uses authorization code + PKCE) |
| Supported account types | *Accounts in this organizational directory only* (single tenant) |
| API permissions | Microsoft Graph, delegated: `openid`, `profile`, `email` (plus the default `User.Read`) |

- The "Sign in with Microsoft" button appears once all three `AZURE_AD_*` values are set.
- SSO **never creates accounts**. An admin first adds the employee in ShiftGo with the same email
  as their Microsoft account. The first Microsoft sign-in links the two.
- **Sign out** ends the ShiftGo session (deletes it server-side and clears the cookie). The session
  cookie is `SameSite=Strict`, so Microsoft's front-channel logout (a hidden cross-site iframe) can't
  reach it. That's why the Front-channel logout URL stays empty.
- The redirect URI must be **HTTPS**: Entra ID only allows `http://` for `localhost`.

## HTTPS (required)

Login cookies are only marked `Secure`, Microsoft sign-in only works, and browser geolocation only works
over HTTPS. Point `iocab.shiftgo.infoapps.io` at a TLS terminator in front of the `proxy`
container: Kubernetes ingress, AWS ALB, Cloudflare, or a host Nginx with certbot
(`deploy/nginx-shiftgo.conf`). It must forward `Host` and `X-Forwarded-Proto: https`, and the bundled
Nginx passes them through. If a load balancer sits in front, configure `ngx_http_realip_module` in
`docker/nginx.conf` so login rate limiting sees real client IPs.

Never publish the `app` port 3000 directly: the app trusts `X-Real-IP`/`X-Forwarded-Proto` because
only the proxy can reach it.

## Optional: n8n automations

```bash
docker compose --profile automation up -d      # n8n on http://localhost:5678
```

1. Import `automations/01-notification-dispatcher.json` and `02-sos-and-daily-reports.json`.
2. In each workflow's **Configuration** node set `baseUrl` to `http://app:3000`, then set up the
   credentials as described in `automations/README.md`.
3. In `.env` set `N8N_WEBHOOK_URL=http://n8n:5678/webhook/cab-notification-wakeup`,
   `N8N_WEBHOOK_SECRET` and `AUTOMATION_API_KEY`, then `docker compose up -d`.

## Operations

| Task | Command |
|---|---|
| Logs | `docker compose logs -f app` |
| Health | `curl -s localhost:8088/api/health` → `{"ok":true,...}` (also proves the DB connection) |
| Update to new code | `docker compose up -d --build` |
| Typecheck + tests in Docker | `docker build --target test .` |
| Tests against PostgreSQL | `TEST_DATABASE_URL=postgres://user:pass@host:5432/emptydb npm test` (**wipes** that database's `public` schema) |
| Back up | `docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' > shiftgo-$(date +%F).dump` |
| Restore | `docker compose stop app`; `docker compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' < file.dump`; `docker compose start app` |
| psql shell | `docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" "$POSTGRES_DB"'` |
| Reset everything (**deletes all data**) | `docker compose down -v` |

Run **one** `app` replica. The every-minute maintenance tick runs in each app process, so more
replicas would duplicate it.

## Schema changes

Add a numbered SQL file to **both** `drizzle/` (SQLite/D1) and `db/migrations-pg/` (PostgreSQL).
Keep queries in `lib/` portable (`?` placeholders, ISO-8601 text timestamps, integer 0/1 flags), and
run the tests against both databases.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Set POSTGRES_PASSWORD in .env` | `.env` is missing or has no `POSTGRES_PASSWORD` |
| App unhealthy, log shows `password authentication failed` | The password changed after the volume was created. Postgres keeps the original one. Restore it, or `ALTER USER` via psql |
| "Sign in with Microsoft" button missing | One of the three `AZURE_AD_*` values is empty or not a GUID |
| Microsoft error `AADSTS50011` (redirect URI mismatch) | Register exactly `https://iocab.shiftgo.infoapps.io/api/auth/sso/callback` as a **Web** redirect URI |
| Microsoft sign-in says the account is not linked | Add the employee in ShiftGo with the same email first |
| Saves/logins return **403 "must be performed from the app"** | The outer proxy must forward `Host` and `X-Forwarded-Proto` |
| Browser shows another app on the port | Something else listens there (e.g. Jenkins via WSL on 8080). Change `SHIFTGO_HTTP_PORT` |
| Build runs out of memory | Give Docker at least 4 GB RAM |
