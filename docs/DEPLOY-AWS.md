# Deploying ShiftGo on AWS (CodeCommit → CodeBuild → CodeDeploy → EC2)

```
git push ─▶ CodeCommit ─▶ CodePipeline ─┬─▶ CodeBuild   typecheck, tests, `npm run build:node`, package
                                        └─▶ CodeDeploy  EC2: stop → back up DB → install → start → health check
                                                         (automatic rollback if the health check fails)
Users ─HTTPS─▶ Route 53 ─▶ EC2: Nginx (TLS) ─▶ Node.js ShiftGo :3000 ─▶ SQLite /var/lib/shiftgo/shiftgo.db
```

ShiftGo uses SQLite, so it runs on **one** EC2 instance with a persistent EBS volume.
SOS escalations and daily reports run inside the app every minute; no cron job is needed.

Files involved:

| File | Purpose |
|---|---|
| `buildspec.yml` | CodeBuild: `npm ci`, typecheck, tests, `npm run build:node`, packages `appspec.yml` + `deploy/` + `app/` |
| `appspec.yml` | CodeDeploy: copies the revision to `/opt/shiftgo/staging` and runs the hooks |
| `deploy/*.sh` | Hooks: stop, back up DB, install release, start, health check |
| `deploy/shiftgo.service` | systemd unit (installed automatically) |
| `deploy/shiftgo.env.example` | Template for `/etc/shiftgo.env` (configuration + secrets) |
| `deploy/nginx-shiftgo.conf` | Nginx reverse proxy template |
| `scripts/build-node.mjs`, `lib/node-runtime.ts` | Node.js build target (SQLite + `process.env` instead of Cloudflare D1/bindings) |

Region used below: `ap-south-1` (Mumbai). Replace `cab.yourcompany.com` with your domain throughout.

---

## 1. One-time: EC2 instance

1. **IAM role for the instance** (e.g. `ShiftGoEC2Role`) with:
   - `AmazonSSMManagedInstanceCore` (Session Manager access, no SSH keys needed)
   - `AmazonEC2RoleforAWSCodeDeploy` (lets the CodeDeploy agent download revisions from S3)
   - optional: `s3:PutObject` on your backup bucket, if you set `BACKUP_S3_URI`
2. **Launch** Ubuntu Server 24.04 LTS, **x86_64** (CodeBuild builds for x86_64), `t3.small`, 20 GB gp3,
   attach the role, and tag it **`App = shiftgo`**.
3. **Security group:** inbound 80 and 443 from `0.0.0.0/0`; no port 22 needed (use Session Manager).
4. **Elastic IP:** allocate and associate it with the instance.
5. Connect (EC2 console → Connect → Session Manager) and install the prerequisites:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl nginx certbot python3-certbot-nginx sqlite3 ruby-full wget unzip

# Node.js 22 (needs >= 22.13 for the built-in SQLite module)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v && node -e "require('node:sqlite')" && echo "node OK"

# AWS CLI (used for optional S3 backups)
curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscli.zip
unzip -q /tmp/awscli.zip -d /tmp && sudo /tmp/aws/install

# CodeDeploy agent
cd /tmp && wget https://aws-codedeploy-ap-south-1.s3.ap-south-1.amazonaws.com/latest/install
chmod +x ./install && sudo ./install auto
sudo systemctl enable --now codedeploy-agent && systemctl status codedeploy-agent --no-pager
```

6. **Configuration file** — copy `deploy/shiftgo.env.example` to `/etc/shiftgo.env` and fill it in:

```bash
sudo nano /etc/shiftgo.env          # paste the template, set SITE_URL, SETUP_TOKEN, …
sudo chmod 600 /etc/shiftgo.env
openssl rand -hex 32                # use for SETUP_TOKEN (and AUTOMATION_API_KEY)
```

## 2. One-time: DNS and HTTPS

1. **Route 53** → Hosted zones → your domain → *Create record*:
   `cab` · type **A** · value = the Elastic IP. (If the domain is registered elsewhere, point its
   name servers to the Route 53 hosted zone, or ask whoever manages DNS to add the A record.)
2. Wait until `nslookup cab.yourcompany.com` returns the Elastic IP, then:

```bash
sudo cp deploy/nginx-shiftgo.conf /etc/nginx/sites-available/shiftgo   # or paste it
sudo sed -i 's/cab.yourcompany.com/<your domain>/' /etc/nginx/sites-available/shiftgo
sudo ln -s /etc/nginx/sites-available/shiftgo /etc/nginx/sites-enabled/shiftgo
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d <your domain> --redirect -m you@yourcompany.com --agree-tos -n
```

Certificates renew automatically (`systemctl list-timers | grep certbot`).

## 3. One-time: CodeCommit repository

1. CodeCommit → *Create repository* → `shiftgo`.
2. IAM → your user → *Security credentials* → **HTTPS Git credentials for AWS CodeCommit** → Generate.
3. From the project folder:

```bash
git init -b main
git add . && git commit -m "ShiftGo initial import"
git remote add aws https://git-codecommit.ap-south-1.amazonaws.com/v1/repos/shiftgo
git push aws main
```

`.gitignore` already excludes `node_modules`, `dist`, `.env*` and local state; `.gitattributes`
keeps the deploy scripts in Linux (LF) line endings.

## 4. One-time: CodeDeploy application

1. IAM → create a service role for **CodeDeploy** (use case *CodeDeploy*; policy `AWSCodeDeployRole`).
2. CodeDeploy → Applications → *Create application*: name `shiftgo`, platform **EC2/On-premises**.
3. *Create deployment group*: name `production`, the service role above,
   environment **Amazon EC2 instances**, tag `App = shiftgo`,
   deployment configuration **CodeDeployDefault.AllAtOnce**, **no load balancer**,
   *Rollbacks*: ✔ **Roll back when a deployment fails**.

## 5. One-time: CodePipeline (creates the CodeBuild project too)

CodePipeline → *Create pipeline* → *Build custom pipeline*:

| Step | Setting |
|---|---|
| Pipeline | name `shiftgo`, type **V2**, new service role |
| Source | **AWS CodeCommit**, repo `shiftgo`, branch `main`, detection **Amazon EventBridge** (recommended), output **CodePipeline default** |
| Build | **AWS CodeBuild** → *Create project*: name `shiftgo-build`, managed image **Amazon Linux**, runtime *Standard*, image `aws/codebuild/amazonlinux-x86_64-standard:5.0` (or newer), compute 4 GB/2 vCPU or larger, **Use a buildspec file** (`buildspec.yml`) |
| Deploy | **AWS CodeDeploy**, application `shiftgo`, deployment group `production` |

Optional but recommended for a safety app: add a **Manual approval** stage between Build and
Deploy, and an SNS notification rule for pipeline failures.

Creating the pipeline starts the first run immediately.

## 6. First launch

1. Watch the pipeline; in CodeDeploy, open the deployment to see each hook's log.
2. Open `https://cab.yourcompany.com`, enter the `SETUP_TOKEN` value as **Setup key**, and create the
   first administrator. Setup is disabled permanently once an account exists.
3. Integrations:
   - **n8n**: re-import the workflows from the admin console (Automations) and set their `baseUrl`
     to `https://cab.yourcompany.com`; fill `AUTOMATION_API_KEY`, `N8N_WEBHOOK_URL`, `N8N_WEBHOOK_SECRET`.
   - **Microsoft SSO**: in Entra ID add the redirect URI `https://cab.yourcompany.com/api/auth/sso/callback`
     and fill the `AZURE_AD_*` values.
   - After editing `/etc/shiftgo.env`: `sudo systemctl restart shiftgo`.

## Day-to-day

| Task | How |
|---|---|
| Release a change | `git push aws main` — live in ~5–8 min if typecheck, tests and health check pass |
| App settings (recipients, Teams channels, report time, locations) | Admin console → Settings; immediate, no deployment |
| Secrets / SSO / n8n connection | edit `/etc/shiftgo.env`, `sudo systemctl restart shiftgo` (~3 s) |
| Logs | `journalctl -u shiftgo -f` |
| Status | `systemctl status shiftgo`, `curl -s localhost:3000/api/health` |
| Roll back | CodeDeploy → deployment group → redeploy an earlier successful revision (failed deployments roll back automatically) |
| Restore the database | `sudo systemctl stop shiftgo`; `gunzip -c /var/lib/shiftgo/backups/<file>.db.gz > /var/lib/shiftgo/shiftgo.db`; remove `shiftgo.db-wal`/`-shm`; `chown shiftgo:shiftgo`; start |

Backups: every deployment stores a copy in `/var/lib/shiftgo/backups` (newest 14 kept) and, if
`BACKUP_S3_URI` is set, in S3. Also enable daily **EBS snapshots** (EC2 → Lifecycle Manager), and
consider a nightly cron: `sqlite3 /var/lib/shiftgo/shiftgo.db ".backup /tmp/s.db"` + `aws s3 cp`.

Deploy during the day: a deployment stops the app for a few seconds, during which SOS cannot be sent.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Deployment fails at **BeforeInstall**: `/etc/shiftgo.env is missing` | Create it (section 1.6) |
| `$'\r': command not found` in a hook | Scripts were committed with Windows line endings; `.gitattributes` prevents this — re-add with `git add --renormalize .` |
| **ValidateService** fails | `journalctl -u shiftgo -n 100`; usually a typo in `/etc/shiftgo.env` or Node < 22.13 |
| Every save/login returns **403 "must be performed from the app"** | Nginx must send `Host` and `X-Forwarded-Proto`, and `/etc/shiftgo.env` must contain `VINEXT_TRUST_PROXY=1` |
| CodeDeploy deployment stays *Pending* | CodeDeploy agent not running or instance tag/role missing: `systemctl status codedeploy-agent` |
| Geolocation or login cookies don't work | The site must be opened over **HTTPS** |

## Local check of the Node build

```bash
npm run build:node
DATABASE_PATH=./data/shiftgo.db PORT=3000 node dist/standalone/server.js
# http://localhost:3000  (first-admin setup is allowed from localhost without a setup key)
```
