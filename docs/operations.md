# Operations

## 1. One-time setup

Order matters; each step produces a value a later step needs.

### 1.1 GitHub

1. Repository `jwvanderstam/readmyagent`, private.
2. Branch protection on `main`: require pull request, require status checks `ci`, disallow force push.
3. Enable secret scanning and Dependabot alerts.

### 1.2 Google Cloud (Drive access)

1. Create a Google Cloud project, for example `readmyagent`.
2. Enable the **Google Drive API**.
3. Create a **service account** `readmyagent-drive`. No project roles needed.
4. Create a JSON key for it. Store it only in Vercel (step 1.4); delete the local copy afterwards.
5. In Google Drive, share the folder `Claude-agents` with the service account's email address as **Editor**.
6. In that folder, create an empty file `feedback.json` yourself (so that you own it) with the content:
   ```json
   { "contract_version": "1.0", "generated_at": "2026-01-01T00:00:00Z", "entries": [] }
   ```
   Note its file ID.

### 1.3 Google sign-in (Auth.js)

1. In the same Google Cloud project: OAuth consent screen, type External, scopes `openid`, `email`, `profile` only.
2. Create an OAuth client ID of type Web application.
3. Authorized redirect URIs: `https://<production-domain>/api/auth/callback/google` and `http://localhost:3000/api/auth/callback/google`.

### 1.4 Vercel and Neon

1. Import the GitHub repository in Vercel (Hobby).
2. Add **Neon** from the Vercel Marketplace and link it to the project. This injects `DATABASE_URL` (and related variables) for each environment.
3. Set the environment variables below.
4. Deploy. Run migrations: `pnpm db:migrate` against production from CI or locally with the production URL.

## 2. Environment variables

| Name | Environments | Description |
|---|---|---|
| `DATABASE_URL` | all | Injected by the Neon integration |
| `AUTH_SECRET` | all | Random 32+ bytes, `openssl rand -base64 32` |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | all | OAuth client from 1.3 |
| `OWNER_EMAIL` | all | The only account allowed to sign in |
| `GOOGLE_SA_KEY` | all | Service account JSON key, base64 encoded |
| `DRIVE_FOLDER_ID` | all | ID of `Claude-agents` |
| `DRIVE_FEEDBACK_FILE_ID` | all | ID of `feedback.json` from 1.2 step 6 |
| `CRON_SECRET` | production | Random secret; Vercel sends it as bearer token to cron routes |
| `APP_TIMEZONE` | all | `Europe/Amsterdam` |

`.env.example` lists the same names without values.

## 3. Local development

```bash
pnpm install
cp .env.example .env.local   # fill in values, use a Neon dev branch for DATABASE_URL
pnpm db:migrate
pnpm dev
```

Use a separate Drive test folder with fixture files for local work, not the production folder.

## 4. Runbook

| Symptom | Check | Action |
|---|---|---|
| No new runs appear | Sync history page: last `sync_runs` status | Trigger manual sync; if it fails, check Vercel function logs for `drive.*` events |
| Run files present in Drive but not in reader | Ingest errors page | Fix the agent prompt for invalid JSON; mark error resolved; re-sync |
| Agent shows `missing` slots | Scheduled task list in Claude; Drive folder for that day | If the task did not fire: re-enable or fire it manually. If it fired without a JSON file: check its session output |
| Feedback stays `published` | Agent run JSON `feedback_consumed` | Check the agent prompt still contains the feedback step |
| `storageQuotaExceeded` from Drive | Code path tried to create a file | Bug: the app must only update `feedback.json`. See ADR-0006 |
| Service account key leaked | | Disable key in Google Cloud, create new key, update `GOOGLE_SA_KEY`, redeploy |

## 5. Agent changes

Each scheduled agent needs three additions to its prompt to participate (phase 1):

1. At the start: read `feedback.json` (ID in `DRIVE_FEEDBACK_FILE_ID`) and apply entries addressed to it, following contract section 3.3.
2. At the end: write the run JSON file following the contract, in addition to the Markdown log, also on failure.
3. List applied feedback IDs in `feedback_consumed`.

## 6. Backup and restore

- Weekly GitHub Action dumps the owner-owned tables to an encrypted artifact (phase 1).
- Restore: run migrations on an empty database, restore the dump, run a full re-sync from Drive to rebuild runs and items.
