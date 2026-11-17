# Operations

Every readmyagent deployment is an instance owned by one person, on that person's own GitHub, Vercel, Neon and Google Cloud accounts (ADR-0007). This guide is written for that owner.

## 1. One-time setup

Order matters; each step produces a value a later step needs. A `gcloud` setup script and a "Deploy to Vercel" button that automate most of this are phase 1 deliverables; until then, follow the manual steps.

### 1.1 GitHub

1. Fork `jwvanderstam/readmyagent` to your own account. A private fork is fine.
2. In your fork: enable secret scanning with push protection, and Dependabot alerts.
3. Do not enable automatic syncing of upstream `main`. Update by merging release tags (section 6).

### 1.2 Vercel and Neon

1. Import your fork in Vercel (Hobby). Note your **team slug** (from the team URL) and the **project name**. Google Cloud needs both in step 1.3.
2. Settings, Security, **Secure backend access with OIDC federation**: set issuer mode to **Team**.
3. Add **Neon** from the Vercel Marketplace and link it to the project. This injects `DATABASE_URL` per environment.
4. Preview databases must not contain production data. In the Neon integration, either turn off automatic preview branches or make previews branch from a separate development branch that holds fixture data only.
5. Keep **Deployment Protection** on for preview deployments.

### 1.3 Google Cloud: Drive access without a key

The app reads the agent folder and updates `feedback.json` as a service account, authenticated through Workload Identity Federation with Vercel's OIDC token (ADR-0008). No key file is created.

Replace `<project-id>`, `<project-number>`, `<team>` and `<vercel-project>`:

```bash
gcloud config set project <project-id>
gcloud services enable drive.googleapis.com iamcredentials.googleapis.com sts.googleapis.com

gcloud iam service-accounts create readmyagent-drive --display-name="readmyagent Drive"

gcloud iam workload-identity-pools create vercel --location=global --display-name="Vercel"
gcloud iam workload-identity-pools providers create-oidc vercel \
  --location=global --workload-identity-pool=vercel \
  --issuer-uri="https://oidc.vercel.com/<team>" \
  --allowed-audiences="https://vercel.com/<team>" \
  --attribute-mapping="google.subject=assertion.sub" \
  --attribute-condition="assertion.sub.startsWith('owner:<team>:project:<vercel-project>:')"

gcloud iam service-accounts add-iam-policy-binding \
  readmyagent-drive@<project-id>.iam.gserviceaccount.com \
  --role=roles/iam.workloadIdentityUser \
  --member="principal://iam.googleapis.com/projects/<project-number>/locations/global/workloadIdentityPools/vercel/subject/owner:<team>:project:<vercel-project>:environment:production"
```

Then, in Google Drive:

1. Share the folder `Claude-agents` with `readmyagent-drive@<project-id>.iam.gserviceaccount.com` as **Editor**.
2. In that folder, create an empty file `feedback.json` yourself (so that you own it) with the content:
   ```json
   { "contract_version": "1.0", "generated_at": "2026-01-01T00:00:00Z", "entries": [] }
   ```
   Note its file ID.

Only the `production` environment is granted. Previews get no access to this folder. To test Drive in previews, repeat the steps with a second service account, a test folder, and the subject `environment:preview`.

Do not create a key for the service account. The key-based setup (ADR-0006) is a fallback for environments without Vercel OIDC only; see section 2.

### 1.4 Google sign-in (Auth.js)

1. In the same Google Cloud project: OAuth consent screen, type External, scopes `openid`, `email`, `profile` only. Add yourself as test user.
2. Create an OAuth client ID of type Web application.
3. Authorized redirect URIs: `https://<production-domain>/api/auth/callback/google` and `http://localhost:3000/api/auth/callback/google`.

### 1.5 Configure and deploy

1. In Vercel, set the environment variables from section 2. Mark every secret as **Sensitive**. Set production values for the Production environment only.
2. Deploy. Run migrations: `pnpm db:migrate` against production from CI or locally with the production URL.
3. Open the app. If a required setting is missing or invalid, the app shows only its setup page, which lists per setting whether it is configured.

## 2. Environment variables

| Name | Environments | Secret | Description |
|---|---|---|---|
| `DATABASE_URL` | all | yes | Injected by the Neon integration |
| `AUTH_SECRET` | all | yes | Random 32+ bytes, `openssl rand -base64 32` |
| `AUTH_GOOGLE_ID` | all | no | OAuth client from 1.4 |
| `AUTH_GOOGLE_SECRET` | all | yes | OAuth client from 1.4 |
| `OWNER_EMAIL` | all | no | The only account allowed to sign in |
| `GCP_PROJECT_NUMBER` | production | no | Google Cloud project number |
| `GCP_SERVICE_ACCOUNT_EMAIL` | production | no | `readmyagent-drive@<project-id>.iam.gserviceaccount.com` |
| `GCP_WORKLOAD_IDENTITY_POOL_ID` | production | no | `vercel` |
| `GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID` | production | no | `vercel` |
| `DRIVE_FOLDER_ID` | production | no | ID of `Claude-agents` |
| `DRIVE_FEEDBACK_FILE_ID` | production | no | ID of `feedback.json` from 1.3 |
| `CRON_SECRET` | production | yes | Random secret; Vercel sends it as bearer token to cron routes |
| `APP_TIMEZONE` | all | no | For example `Europe/Amsterdam` |
| `GOOGLE_SA_KEY` | fallback only | yes | Base64 service account key. Only where Vercel OIDC is unavailable, for a test folder. Ignored when the `GCP_*` variables are set |

`.env.example` lists the same names without values. No variable holding a secret may use the `NEXT_PUBLIC_` prefix.

## 3. Local development

```bash
pnpm install
vercel link                  # once, links the folder to your Vercel project
vercel env pull .env.local   # development values, including a short-lived VERCEL_OIDC_TOKEN
pnpm db:migrate              # against a Neon development branch, never production
pnpm dev
```

Use a separate Drive test folder with fixture files for local work, not the production folder. Grant it to the `development` environment subject, or use the `GOOGLE_SA_KEY` fallback with a key for a test-only service account.

## 4. Runbook

| Symptom | Check | Action |
|---|---|---|
| App shows only the setup page | The settings it marks as missing or invalid | Set them in Vercel for the right environment; redeploy |
| No new runs appear | Sync history page: last `sync_runs` status | Trigger manual sync; if it fails, check Vercel function logs for `drive.*` events |
| `drive.auth_failed` in logs | Workload identity provider and binding in Google Cloud | Check the issuer uses your team slug, the attribute condition matches your Vercel project name, and the binding subject ends in `environment:production`. A renamed Vercel project or team needs a new binding |
| Run files present in Drive but not in reader | Ingest errors page | Fix the agent prompt for invalid JSON; mark error resolved; re-sync |
| Agent shows `missing` slots | Scheduled task list in Claude; Drive folder for that day | If the task did not fire: re-enable or fire it manually. If it fired without a JSON file: check its session output |
| Feedback stays `published` | Agent run JSON `feedback_consumed` | Check the agent prompt still contains the feedback step |
| `storageQuotaExceeded` from Drive | Code path tried to create a file | Bug: the app must only update `feedback.json`. See ADR-0006 and ADR-0008 |
| Fallback key leaked (`GOOGLE_SA_KEY`) | | Disable the key in Google Cloud, create a new one, update the variable, redeploy |
| Any other secret leaked | Which one | Rotate it at its source (Neon, Google OAuth client, `openssl` for `AUTH_SECRET` and `CRON_SECRET`), update Vercel, redeploy |

## 5. Agent changes

Each scheduled agent needs three additions to its prompt to participate (phase 1):

1. At the start: read `feedback.json` (ID in `DRIVE_FEEDBACK_FILE_ID`) and apply entries addressed to it, following contract section 3.3.
2. At the end: write the run JSON file following the contract, in addition to the Markdown log, also on failure.
3. List applied feedback IDs in `feedback_consumed`.

Agents are registered in the app (name, slug, schedule), not in code.

## 6. Updating your instance

1. Read the release notes in `CHANGELOG.md` of the upstream repository.
2. Merge the release tag into your fork, for example `git fetch upstream --tags && git merge v0.2.0`.
3. Let CI pass, deploy, and run migrations if the release lists any.

Do not configure your fork to deploy upstream `main` automatically: you would run code nobody has released yet.

## 7. Backup and restore

- Weekly GitHub Action in your fork dumps the owner-owned tables to an artifact encrypted with a key only you hold (phase 1). Artifacts of a public repository can be downloaded by any GitHub user, so the dump is never stored unencrypted, and the job does not run in the upstream repository.
- Restore: run migrations on an empty database, restore the dump, run a full re-sync from Drive to rebuild runs and items.
