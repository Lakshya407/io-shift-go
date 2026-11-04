# ShiftGo · Cab Safety

A mobile-friendly cab check-in app for night-shift employees, with a separate administrator console. Employees record boarding, arrival and SOS events; administrators manage accounts, watch journeys live, respond to SOS alerts, configure the app and download reports.

Stack: Next.js-style app router (via `vinext`) on **Cloudflare Workers**, with **Cloudflare D1** (SQLite) for storage. Locally everything runs offline: D1 is emulated in `.wrangler/state`.

## The two windows

| URL      | Who              | What                                                                                     |
|----------|------------------|------------------------------------------------------------------------------------------|
| `/`      | everyone         | Sign-in (and first-run admin setup). Redirects to `/admin` or `/app` after sign-in.      |
| `/admin` | administrators   | Overview, live journeys, employees, SOS alerts (with sound alarm), reports, settings.    |
| `/app`   | employees (+ admins) | "I'm in the cab", "Reached home/office", SOS button, journey history.                |

Employees who open `/admin` are sent to `/app`. Every admin route is also enforced on the server. Both windows have a light/night mode toggle and a **Log out** button in the top-right navbar.

## Access control (RBAC)

**Admin → Access control** lists every user (name, role, email, office, last active, created). You can search and sort, click a role to change it, and view, edit, email or delete users. **Roles & permissions** lets you create custom roles from these permissions:

| Permission | Unlocks |
|---|---|
| `dashboard.view` | Admin console: overview, journeys |
| `alerts.manage` | Acknowledge/resolve SOS, notification delivery |
| `employees.manage` | Add/edit/deactivate/delete users |
| `reports.view` | Daily reports, CSV export |
| `settings.manage` | Company, branding, locations, recipients |
| `automations.manage` | n8n tokens |
| `rbac.manage` | Roles and role changes |

The built-in roles are **Admin** (everything) and **User** (employee app only). Two starter roles, *Transport manager* and *Security desk*, can be edited. Each nav item only appears with its permission, and the API enforces the same permissions. Safety rules: you can't change your own role or delete yourself, and the last active admin can't be removed. Deleting a user with journey history archives them so reports stay intact.

### Microsoft (Azure AD / Entra ID) SSO

When configured, the login page shows a **Sign in with Microsoft** button (OpenID Connect, authorization code + PKCE, implemented in `lib/sso.ts`).

| Endpoint | Purpose |
|---|---|
| `GET /api/auth/sso/start?next=/admin` | Redirects to Microsoft sign-in |
| `GET /api/auth/sso/callback` | **Redirect URI**: Microsoft sends the user back here |

Setup:

1. Entra admin center → **App registrations → New registration**, single tenant. Under **Redirect URI** pick platform **Web** and add:
   - local: `http://localhost:5173/api/auth/sso/callback` (also `http://127.0.0.1:5173/api/auth/sso/callback` if you open the app on 127.0.0.1)
   - deployed: `https://<your-domain>/api/auth/sso/callback`
2. **Certificates & secrets → New client secret**. Copy the value.
3. Set `AZURE_AD_TENANT_ID` (Directory ID), `AZURE_AD_CLIENT_ID` (Application ID) and `AZURE_AD_CLIENT_SECRET` in `.dev.vars` locally, or with `npx wrangler secret put` when deployed. The redirect URI is derived from `SITE_URL` (or the request origin); set `AZURE_AD_REDIRECT_URI` to override it.

SSO does not create accounts. A Microsoft user signs in to an existing active account, matched by Entra object id (`employees.sso_subject`) or, on first use, by work email. The object id is then stored and the account shows "Company SSO" in Access control. Only users from the configured tenant are accepted.

## Office locations

The defaults are **Noida (Uttar Pradesh), Pune (Maharashtra) and Dehradun (Uttarakhand)**. Edit them in **Settings → Workspace → Office locations**. Each employee is assigned an office, and the navbar location selector filters journeys, employees and alerts by office. The SOS banner always shows alerts from every office.

## Theme

Night mode styles are generated from `app/globals.css` into `app/theme-dark.css`. After changing `globals.css`, run `npm run theme:dark`. To fine-tune night mode, edit the hand-tuned block in `scripts/generate-dark-theme.mjs`.

## Run locally

Requires Node.js 22.13+.

```sh
npm ci
npm run dev          # http://127.0.0.1:5173
```

1. Open http://127.0.0.1:5173. On a fresh database the **first-run setup** form appears: create the administrator account (password at least 12 characters).
2. In **Employees → Add employee**, create accounts with a temporary password. Employees sign in with their employee ID or email and must change the password on first sign-in.
3. Employees use `/app` on their phones; admins use `/admin`.

Database tables are created automatically on the first request. You don't need to run any migration command. To test on a phone on the same Wi-Fi, run `HOST=0.0.0.0 npm run dev` and open `http://<your-PC-IP>:5173`. Create the admin on the PC first, because setup without a key only works from localhost. Location capture on phones needs HTTPS (for example, the deployed site); without it the trip is still recorded and marked "location unavailable".

Production-like local run:

```sh
npm run build
npm run start        # serves dist/ with wrangler on http://127.0.0.1:8787
```

## Deploy to AWS (EC2, CI/CD with CodeCommit/CodeBuild/CodeDeploy)

See [docs/DEPLOY-AWS.md](docs/DEPLOY-AWS.md). `npm run build:node` produces a self-contained Node.js server in `dist/standalone` (SQLite file database); `buildspec.yml`, `appspec.yml` and `deploy/` run the pipeline.

## Deploy to Cloudflare

```sh
npx wrangler login
npx wrangler d1 create nightshift-db           # copy the database_id into wrangler.jsonc
npx wrangler secret put SETUP_TOKEN            # any long random string
npx wrangler secret put SITE_URL               # e.g. https://nightshift-cab.<account>.workers.dev
npm run deploy
```

Open the site and enter the `SETUP_TOKEN` value as the **Setup key** to create the first administrator. On a deployed site, setup is impossible without the key, and it's permanently disabled once an account exists.

The cron trigger in `wrangler.jsonc` runs every minute: it sends SOS reminder escalations and generates the daily report after each shift cutoff (Settings → Reports & safety). The app also runs the same maintenance opportunistically while it's in use.

## Configuration

| Variable | Required | Purpose |
|---|---|---|
| `SETUP_TOKEN` | deployed: yes | Key needed to create the first administrator. |
| `SITE_URL` | recommended | Public URL used in notification links. |
| `AUTOMATION_API_KEY` | no | Static n8n credential (or generate a token in Admin → Automations). |
| `N8N_WEBHOOK_URL`, `N8N_WEBHOOK_SECRET` | no | Wake n8n immediately when a notification is queued. |
| `AZURE_AD_TENANT_ID`, `AZURE_AD_CLIENT_ID`, `AZURE_AD_CLIENT_SECRET` | no | Enable "Sign in with Microsoft". |
| `AZURE_AD_REDIRECT_URI` | no | Override the SSO callback URL (default `<SITE_URL>/api/auth/sso/callback`). |

Locally, put these in `.dev.vars` (see `.dev.vars.example`). In production, use `wrangler secret put`.

Company name, branding, button labels, emergency phone, recipients, report times and SOS reminder intervals are all edited in **Admin → Settings**.

## Teams & email (optional, via n8n)

The app works on its own: admins see check-ins and SOS alerts live in the console, with an audible alarm and browser notification for new SOS alerts. Teams and email delivery comes from the n8n workflows in `automations/` (see [automations/README.md](automations/README.md)): import them, generate a token in **Admin → Automations**, and set recipients in **Settings → Notifications**.

## Verification

```sh
npm test             # 40 API integration assertions + n8n workflow checks
npm run typecheck
```

## Notes

- Sessions are 12-hour HttpOnly cookies, `Secure` whenever the site is served over HTTPS. Passwords use PBKDF2. Login attempts are rate-limited.
- SOS is never queued offline: if the device is offline, the app tells the employee to call the emergency phone instead. Board/arrive events made offline are saved on the device and synced later.
- A saved SOS, a provider-accepted notification and an administrator acknowledgement are tracked as separate states. See [docs/OPERATIONS.md](docs/OPERATIONS.md) before rolling out.
- Schema changes: edit `db/schema.ts`, run `npm run db:generate`. New files in `drizzle/` are applied automatically on the next request (tracked in the `nightshift_migrations` table).
