# Operations

Every readmyagent deployment is an instance owned by one person, on that person's own GitHub, Vercel, Neon and Google Cloud accounts (ADR-0007). This guide is written for that owner.

## 1. One-time setup

Order matters; each step produces a value a later step needs. The "Deploy to Vercel" button in the README (1.2), `scripts/setup-gcloud.sh` (1.3) and `scripts/set-vercel-env.ps1` (1.5) automate most of it.

### 1.1 GitHub

1. Fork `jwvanderstam/readmyagent` to your own account. A private fork is fine.
2. In your fork: enable secret scanning with push protection, and Dependabot alerts.
3. Do not enable automatic syncing of upstream `main`. Update by merging release tags (section 6).

### 1.2 Vercel and Neon

Vercel project:

1. **Add New > Project**, import your fork. Keep the detected Next.js settings and deploy. Or use the **Deploy to Vercel** button in the README: it copies the repository to your GitHub account and imports it in one go. Its copy is not a fork; add this repository as the `upstream` remote to update by release tag (section 6). The first deployment shows only the setup page: the app stays closed until its configuration is complete.
2. Note the **team slug** (from the dashboard URL), the **project name** and the **production URL**. Google Cloud needs the first two in step 1.3, the OAuth client the third in step 1.4.
3. **Settings > Build and Deployment > Node.js Version**: set **22.x**, the version in `package.json` `engines`. A different value is overridden by `engines` and shows an override warning.
4. **Settings > Security > Secure Backend Access with OIDC Federation**: Issuer Mode **Team**.
5. **Settings > Deployment Protection**: keep Vercel Authentication on (Standard Protection).

Neon database, through **Storage > Create Database > Neon**:

1. Region close to you (for example Frankfurt `fra1`), plan Free. Functions run in the region set in `vercel.json` (`regions`, default `fra1`); if you choose another database region, set the same one there, or every query crosses an ocean. Turn **Neon Auth** and **Realtime** off: the app signs in through Google (step 1.4) and does not use them.
2. In **Connect a Project**:
   - Environments: **Production only**. With Preview connected, previews would use the production database.
   - Create database branch for deployment: **off** for both.
   - Custom prefix: **`DATABASE`**. The default `STORAGE` creates `STORAGE_URL`, which the app does not read.
   - Sensitive: **on**.
3. Check that `DATABASE_URL` and `DATABASE_URL_UNPOOLED` appear under Environment Variables with scope Production, then redeploy. Variable changes apply only to new deployments.

Consequences: preview deployments have no database and stop at the setup page; the Development environment gets no database either (section 3).

Vercel Hobby is for personal, non-commercial use. An instance used for work needs a Pro team.

### 1.3 Google Cloud: Drive access without a key

The app reads the agent folder and updates `feedback.json` as a service account, authenticated through Workload Identity Federation with Vercel's OIDC token (ADR-0008). No key file is created.

Run the setup script in your own terminal, signed in with `gcloud auth login`:

```bash
scripts/setup-gcloud.sh --project <project-id> --team <team> --vercel-project <vercel-project>
```

It enables the APIs, creates the service account, the pool and the provider, grants the production environment, and prints the `GCP_*` values for section 2. Running it again changes nothing that is already in place; it brings the provider in line with the given team and project.

The same steps by hand. Replace `<project-id>`, `<project-number>`, `<team>` and `<vercel-project>`:

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

In the same Google Cloud project, open **Google Auth Platform** and choose **Get started**:

1. **App Information:** app name `readmyagent`, your address as support email.
2. **Audience:** External. Internal is only available to Google Workspace accounts.
3. **Contact Information:** your address.
4. **Finish:** accept the Google API Services User Data Policy, then **Create**.
5. **Audience > Test users > Add users:** add the address you set as `OWNER_EMAIL` and **Save**. Wait until the panel closes, then reload and confirm the address is listed. Leaving the page while the panel is open loses the entry.
6. **Clients > Create client:** type Web application, no JavaScript origins, one redirect URI: `https://<production-domain>/api/auth/callback/google`.
7. Copy the client ID and secret from the dialog straight into Vercel (`AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, Production, Sensitive). The secret is shown only once.
8. Redeploy.

Decisions for this client:

| Decision | Reason |
|---|---|
| Publishing status stays **Testing**, with the owner as the only test user | One user. Google then blocks every other account before it reaches the app, in front of the app's own owner check. No verification by Google is needed. |
| Scopes `openid`, `email`, `profile` only, requested by the app | Sign-in needs nothing more; Drive access runs through the service account (1.3). Google limits refresh tokens to 7 days for External apps in Testing, unless the scopes are a subset of name, email and profile. Adding a Google API scope brings that limit back. |
| Production redirect URI only | Previews have no database and stop at the setup page, so they never sign in. For local sign-in, add `http://localhost:3000/api/auth/callback/google` deliberately. |
| No JavaScript origins | The app uses the server-side redirect flow (Auth.js), which does not use them. |

**Lost secret or rotation.** Open **Clients > your client**, add a new client secret, replace `AUTH_GOOGLE_SECRET` in Vercel and redeploy. Confirm sign-in works, then disable and delete the old secret.

### 1.5 Configure and deploy

1. In Vercel, set the environment variables from section 2. Mark every secret as **Sensitive**. Set production values for the Production environment only.

   Or let `scripts/set-vercel-env.ps1` do it (PowerShell 7 and Node.js, Windows, macOS or Linux). Run it in your own terminal, never through an AI assistant, because you type the OAuth secret into it:

   ```powershell
   pwsh -ExecutionPolicy Bypass -File scripts/set-vercel-env.ps1 `
     -Team <team> -Project <vercel-project> -OwnerEmail <you@example.com> `
     -DriveFolderId <folder-id> -FeedbackFileId <feedback-file-id> `
     -GcpProjectNumber <project-number> `
     -ServiceAccountEmail readmyagent-drive@<project-id>.iam.gserviceaccount.com
   ```

   It signs you in to Vercel, asks for the OAuth client ID and secret without showing the secret, generates `AUTH_SECRET` and `CRON_SECRET` without showing them, sets all variables except `DATABASE_URL` for Production (overwriting existing values), and redeploys. No secret is written to disk beyond a temporary file deleted right after use.
2. Deploy. Production builds apply pending migrations first (`vercel.json` `buildCommand`, `scripts/migrate.mjs`, over `DATABASE_URL_UNPOOLED`). A failed migration fails the build, so the previous deployment stays live. Preview builds skip this step.
3. Open the app. If a required setting is missing or invalid, the app shows only its setup page, which lists per setting whether it is configured.
4. Agents that write `agent_name` and `schedule` in their run files (contract 1.1) register themselves at the first sync after their first run. Nothing to do. For an agent that does not, register it under **Agents > Add agent**:
   - **Slug:** exactly the `agent` value the task writes in its run files. It cannot be changed later; run files with an unknown slug become ingest errors.
   - **Schedule:** the cron expression of the scheduled task, with `CRON_TZ=<zone>` in front when it runs in a specific timezone. At most hourly.
   - **Grace window:** how long after its time a run may arrive before health shows it as missing (default 180 minutes).
   Agents are deactivated, never deleted: their runs and feedback are your data.

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
| `CRON_SECRET` | production | yes | Random secret of at least 16 characters; Vercel sends it as bearer token to the daily cron (`vercel.json`, 10:00 UTC, may fire later within the hour) |
| `APP_TIMEZONE` | all | no | For example `Europe/Amsterdam` |
| `GOOGLE_SA_KEY` | fallback only | yes | Base64 service account key. Only where Vercel OIDC is unavailable, for a test folder. Ignored when the `GCP_*` variables are set |

`.env.example` lists the same names without values. No variable holding a secret may use the `NEXT_PUBLIC_` prefix.

## 3. Local development

```bash
pnpm install
vercel link                  # once, links the folder to your Vercel project
vercel env pull .env.local   # development values, including a short-lived VERCEL_OIDC_TOKEN
node --env-file=.env.local scripts/migrate.mjs   # the dev branch below, never production
pnpm dev
```

The database integration is connected to Production only, so `vercel env pull` brings no database. Create a branch `dev` in the Neon console (from an empty state or with fixture data only) and set its connection string as `DATABASE_URL` for the **Development** environment in Vercel. Never copy production values to your machine.

Use a separate Drive test folder with fixture files for local work, not the production folder. Grant it to the `development` environment subject, or use the `GOOGLE_SA_KEY` fallback with a key for a test-only service account.

## 4. Runbook

| Symptom | Check | Action |
|---|---|---|
| App shows only the setup page | The settings it marks as missing or invalid | Set them in Vercel for the right environment; redeploy |
| No new runs appear | Sync history page: last `sync_runs` status | Trigger manual sync; if it fails, check Vercel function logs for `sync.failed` and `drive.*` events (`drive.list_failed`, `drive.download_failed`, `drive.feedback_write_failed`) |
| `drive.auth_failed` in logs | Workload identity provider and binding in Google Cloud | Check the issuer uses your team slug, the attribute condition matches your Vercel project name, and the binding subject ends in `environment:production`. A renamed Vercel project or team needs a new binding |
| `redirect_uri_mismatch` at Google | The URI in the client differs from `https://<production-domain>/api/auth/callback/google`, or the change has not propagated | Compare exactly; Google states changes can take 5 minutes to a few hours |
| `access_denied`, app is in testing | The account is not a test user | Add it under Audience, or sign in with the owner account |
| `invalid_client` | Wrong client ID or secret, or stray whitespace | Enter both again in Vercel and redeploy |
| Google sign-in succeeds, the app refuses | `OWNER_EMAIL` differs from the Google account address | Compare the two |
| New variable values have no effect | No deployment since the change | Redeploy production |
| Run files present in Drive but not in reader | Ingest errors page | Fix the agent prompt for invalid JSON; mark error resolved; re-sync |
| Agent shows `missing` slots | Scheduled task list in Claude; Drive folder for that day | If the task did not fire: re-enable or fire it manually. If it fired without a JSON file: check its session output |
| Feedback stays `published` | Agent run JSON `feedback_consumed` | Check the agent prompt still contains the feedback step |
| `storageQuotaExceeded` from Drive | Code path tried to create a file | Bug: the app must only update `feedback.json`. See ADR-0006 and ADR-0008 |
| Fallback key leaked (`GOOGLE_SA_KEY`) | | Disable the key in Google Cloud, create a new one, update the variable, redeploy |
| Any other secret leaked | Which one | Rotate it at its source (Neon, Google OAuth client, `openssl` for `AUTH_SECRET` and `CRON_SECRET`), update Vercel, redeploy |

## 5. Agent changes

Each scheduled agent needs four additions to its prompt to participate (phase 1):

1. At the start: read `feedback.json` (ID in `DRIVE_FEEDBACK_FILE_ID`) and apply entries addressed to it, following contract section 3.3.
2. At the end: write the run JSON file following the contract, in addition to the Markdown log, also on failure.
3. List applied feedback IDs in `feedback_consumed`.

4. Write `agent_name` and `schedule` in the run JSON, with the schedule exactly as the task runs. The agent then registers itself, and a changed schedule reaches the app with its next run (ADR-0009).

Agents are registered in the app, by their own run files or by hand, not in code.

## 6. Updating your instance

1. Read the release notes in `CHANGELOG.md` of the upstream repository.
2. Merge the release tag into your fork, for example `git fetch upstream --tags && git merge v0.2.0`.
3. Let CI pass, deploy, and run migrations if the release lists any.

Do not configure your fork to deploy upstream `main` automatically: you would run code nobody has released yet.

## 7. Backup and restore

The workflow `backup` in your fork dumps the whole database every Monday at 03:17 UTC, encrypts the dump with [age](https://age-encryption.org) for a key only you hold, and stores it as a workflow artifact for 56 days. Artifacts of a public repository can be downloaded by any GitHub user, so the dump is encrypted before it is written, and GitHub never holds the key that decrypts it. The workflow does nothing until you configure it, so it never runs upstream.

The dump covers every table, not only the owner-owned ones: items reference runs, and feedback and actions reference items, so a partial dump cannot be restored without breaking those links. It also contains the migration history, so the restored database is at the right schema version.

### 7.1 Set up

1. On your own machine, install age and create a key pair:
   ```bash
   age-keygen -o readmyagent-backup.key
   ```
   It prints the public key (`age1...`). Keep `readmyagent-backup.key` in your password manager or another place outside GitHub and Vercel. Without it no backup can be read.
2. In your fork, **Settings > Secrets and variables > Actions**:
   - Variable `BACKUP_AGE_RECIPIENT`: the public key.
   - Secret `BACKUP_DATABASE_URL`: the value of `DATABASE_URL_UNPOOLED` from Vercel.
   - Variable `BACKUP_PG_VERSION` (optional): the major Postgres version of your Neon project, shown in the Neon console. Default `17`. `pg_dump` refuses to dump a newer server.
3. Forks start with scheduled workflows disabled. Open **Actions**, enable workflows, and run **backup** once by hand.
4. Download the artifact and check that you can decrypt it (7.2, step 1).

### 7.2 Restore

1. Download the newest `backup-*` artifact, unzip it, and decrypt:
   ```bash
   age --decrypt --identity readmyagent-backup.key --output backup.dump readmyagent-<date>.dump.age
   ```
2. Create an empty Neon database and restore into it with `pg_restore` of the same major version:
   ```bash
   pg_restore --no-owner --no-acl --dbname "<new-database-url>" backup.dump
   ```
3. Point `DATABASE_URL` and `DATABASE_URL_UNPOOLED` in Vercel at the new database and redeploy. The build applies any migration newer than the backup.
4. Open the app. Sync on open ingests the runs written since the backup.

Delete `backup.dump` when you are done: it is the unencrypted database.
