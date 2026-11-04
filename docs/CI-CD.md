# ShiftGo CI/CD: GitLab CI + Argo CD

```
git push ─▶ GitLab CI ─┬─ test                 typecheck + API tests on SQLite + n8n workflow checks
 (iogitlab)            ├─ test:postgres        same API tests on a throw-away PostgreSQL 17
                       ├─ security:trivy-fs    Trivy: npm CVEs, committed secrets, Dockerfile/k8s misconfig
                       ├─ build                docker buildx → $CI_REGISTRY_IMAGE:<sha> (+ :latest)      main only
                       ├─ security:trivy-image Trivy: OS + Node.js CVEs in the pushed image             main only
                       ├─ deploy          bumps k8s/kustomization.yaml newTag, commits "[skip ci]"   main only
                       └─ k8s:secrets     (manual) GitLab variables → Secret shiftgo-env in the cluster
                                   │
Argo CD watches k8s/ on main ◀─────┘  → Deployment shiftgo + StatefulSet shiftgo-postgres + Ingress (TLS)
Users ─HTTPS─▶ iocab.shiftgo.infoapps.io ─▶ ingress-nginx ─▶ Service shiftgo ─▶ pod :3000 ─▶ shiftgo-postgres:5432
```

| File | Purpose |
|---|---|
| `.gitlab-ci.yml` | Pipeline |
| `k8s/` | Kustomize manifests Argo CD syncs: `app.yaml`, `postgres.yaml`, `ingress.yaml`, `kustomization.yaml` (image tag) |
| `k8s/optional/cluster-issuer.yaml` | Let's Encrypt issuer for cert-manager (one-time, cluster-wide) |
| `argocd/application.yaml` | Argo CD `Application` (one-time) |

Merge requests and other branches run only the tests. A push to `main` runs everything and is
live roughly 1–3 minutes after the pipeline, once Argo CD syncs.

## 1. GitLab CI/CD variables

Project → **Settings → CI/CD → Variables**. Make `main` a **protected branch**, so that *Protected*
variables are available to its pipelines.

### Pipeline variables

| Key | Type / flags | Value |
|---|---|---|
| `GITOPS_TOKEN` | Masked, Protected | Project access token on this project: role **Maintainer** (it pushes to protected `main`), scope **`write_repository`** |
| `KUBE_CONFIG` | **File**, Protected | kubeconfig for the cluster, used only by the manual `k8s:secrets` job. Prefer a ServiceAccount limited to the `shiftgo` namespace |
| `GITOPS_USER_NAME`, `GITOPS_USER_EMAIL` | optional | Author of the deploy commits |
| `REGISTRY`, `REGISTRY_USER`, `REGISTRY_PASSWORD`, `IMAGE_NAME` | optional, Masked | Only when **not** using the GitLab Container Registry |
| `PULL_USER`, `PULL_PASSWORD` | optional, Masked | Registry pull credentials for the cluster, if you don't create the deploy token below |
| `GITOPS_REPO`, `GITOPS_BRANCH`, `GITOPS_PATH` | optional | Separate GitOps repo (`host/group/repo.git`), branch and folder. Default: this project, `main`, `k8s` |

`CI_REGISTRY*`, `CI_COMMIT_*` and similar are predefined by GitLab. Don't add them.

### App runtime settings

Same keys as `.env`. Copy the values from your local `.env`. The `test` and `build` jobs never read
them, so a wrong or missing value cannot fail the build. Only `k8s:secrets` uses them.

| Key | Flags | Notes |
|---|---|---|
| `SITE_URL` | | `https://iocab.shiftgo.infoapps.io` |
| `SETUP_TOKEN` | Masked, Protected | Setup key for the first admin |
| `POSTGRES_USER`, `POSTGRES_DB` | | default `shiftgo` |
| `POSTGRES_PASSWORD` | Masked, Protected | letters/digits only |
| `DATABASE_URL` | Masked, Protected | only for an external DB (RDS); otherwise built automatically for `shiftgo-postgres` |
| `DATABASE_SSL` | | `require` for RDS |
| `AZURE_AD_TENANT_ID`, `AZURE_AD_CLIENT_ID` | | |
| `AZURE_AD_CLIENT_SECRET` | Masked, Protected | |
| `AZURE_AD_REDIRECT_URI` | | `https://iocab.shiftgo.infoapps.io/api/auth/sso/callback` |
| `AUTOMATION_API_KEY`, `N8N_WEBHOOK_SECRET` | Masked, Protected | n8n only |
| `N8N_WEBHOOK_URL` | | n8n only |

GitLab can only mask values of 8+ characters from a limited character set. If it refuses
`AZURE_AD_CLIENT_SECRET` (`~` is allowed in current versions), set it as *Protected* + *Hidden* instead.

## 2. One-time setup

1. **Container Registry**: enable it (Settings → General → Visibility → Container registry). Check
   the registry host in Deploy → Container Registry. If it is not `iogitlab.infoorigin.com:5050`,
   nothing needs to change: the first `deploy` job writes the real `$CI_REGISTRY_IMAGE` into
   `k8s/kustomization.yaml`.
2. **Deploy token for image pulls**: Settings → Repository → Deploy tokens → name it exactly
   **`gitlab-deploy-token`**, scope **`read_registry`**. GitLab then exposes it to jobs, and
   `k8s:secrets` turns it into the cluster's `gitlab-registry` pull secret.
3. **Runner**: the `build` job uses Docker-in-Docker, so it needs a runner with `privileged = true`
   and at least 4 GB RAM. `test` jobs need about 4 GB as well.
4. **cert-manager** (TLS for the domain): check with `kubectl get crd clusterissuers.cert-manager.io`.
   If it is installed but there's no issuer yet, edit the email in `k8s/optional/cluster-issuer.yaml` and
   `kubectl apply -f` it. If the cluster already has an issuer, put its name in `k8s/ingress.yaml`.
5. **Argo CD**: Settings → Repositories → connect
   `https://iogitlab.infoorigin.com/io-cloud/io-shift-go.git` with a token that has
   `read_repository`, then `kubectl apply -n argocd -f argocd/application.yaml`.
6. **Push to `main`**. When the pipeline finishes, run the manual **`k8s:secrets`** job once. Without
   `KUBE_CONFIG`, create the secrets by hand:

   ```bash
   kubectl create namespace shiftgo
   # Same keys as .env, with DATABASE_URL pointing at the in-cluster service:
   #   DATABASE_URL=postgres://shiftgo:<POSTGRES_PASSWORD>@shiftgo-postgres:5432/shiftgo
   kubectl -n shiftgo create secret generic shiftgo-env --from-env-file=prod.env
   kubectl -n shiftgo create secret docker-registry gitlab-registry \
     --docker-server=<registry host> --docker-username=<deploy token user> --docker-password=<token>
   ```
7. Open `https://iocab.shiftgo.infoapps.io`, enter the setup key, and create the admin account.
   Then try **Sign in with Microsoft**.

## Security scanning (Trivy)

| Job | Scans | Fails the pipeline on |
|---|---|---|
| `security:trivy-fs` (every branch/MR) | `package-lock.json` CVEs, secrets in the code, misconfigurations in `Dockerfile`, `k8s/`, `argocd/` | any **fixable HIGH/CRITICAL** finding |
| `security:trivy-image` (main) | the image just pushed: OS packages + shipped Node modules, secrets | any **fixable HIGH/CRITICAL** finding |

A failed scan stops the pipeline before `deploy`, so a vulnerable build is never rolled out.
Full reports (all severities) are job artifacts (`trivy-*.txt`). Findings also appear in the merge
request (Code Quality widget). The container-scanning report shows in GitLab Ultimate.

- Change the threshold with the CI/CD variable `TRIVY_GATE_SEVERITY` (default `HIGH,CRITICAL`).
- Accept a reviewed risk: add its ID to `.trivyignore` with a reason and an expiry (`exp:YYYY-MM-DD`).
- Run locally: `docker run --rm -v "$PWD:/src" -w /src aquasec/trivy:0.76.1 fs . --scanners vuln,secret,misconfig`

Hardening already in place: distroless non-root runtime image (no shell or package manager), and
read-only root filesystems. Every capability is dropped and seccomp is set to `RuntimeDefault`
for both the app and Postgres pods.

## Day-to-day

| Task | How |
|---|---|
| Release | Merge to `main`. Watch the pipeline, then Argo CD (app `shiftgo`) |
| Change a setting / secret | Edit the GitLab variable → run `k8s:secrets` (restarts the app) |
| Roll back | Revert the `deploy: shiftgo <sha>` commit on `main` (or Argo CD → History → Rollback, which auto-sync will undo unless you pause it) |
| Logs | `kubectl -n shiftgo logs deploy/shiftgo -f` |
| DB backup | `kubectl -n shiftgo exec shiftgo-postgres-0 -- sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' > shiftgo.dump` |

After each deploy, CI pushes a commit to `main`. Run `git pull` before your next push.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `deploy`: `GITOPS_TOKEN` error / 403 on push | Token missing, expired, or role below Maintainer for protected `main` |
| Pod `ImagePullBackOff` | `gitlab-registry` secret missing → deploy token + `k8s:secrets` |
| Pod `CreateContainerConfigError` | Secret `shiftgo-env` missing or lacks `POSTGRES_USER/PASSWORD/DB` → run `k8s:secrets` |
| Pod running but never Ready, log says `DATABASE_URL is not set` | Secret lacks `DATABASE_URL` → `k8s:secrets` builds it |
| Browser shows *Not secure*, "Kubernetes Ingress Controller Fake Certificate" | cert-manager/issuer missing or HTTP-01 challenge blocked: `kubectl -n shiftgo describe certificate shiftgo-tls` |
| nginx **404** on the domain | Ingress not synced yet, or ingress class isn't `nginx`: `kubectl get ingressclass` |
| Login rate limit hits everyone together | Behind an AWS NLB, enable proxy protocol or `externalTrafficPolicy: Local` on ingress-nginx so real client IPs reach the app |
| `build`: `Cannot connect to the Docker daemon` | Runner not privileged (Docker-in-Docker) |
