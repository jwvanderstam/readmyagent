# Architecture

Version 0.1, 2026-11-17. Structure loosely follows arc42.

## 1. Goals

### 1.1 Problem

Scheduled Claude agents run unattended and write their output as separate Markdown files into a Google Drive folder. That works as an archive but not as a working tool:

- Output is scattered across many files and has to be looked up manually.
- There is no history view, no trend, and no way to see at a glance whether an agent silently failed.
- Feedback to an agent (for example "this sender is fine, stop proposing it for deletion") requires hand-editing a state file. Agents cannot overwrite files in Drive through their connector, so they cannot close the loop themselves.
- Follow-up actions that come out of agent findings are not tracked anywhere.

### 1.2 Goals

| ID | Goal |
|---|---|
| G1 | One place to read all agent output, from any device |
| G2 | Detect missing or failed runs within one day |
| G3 | Give feedback per finding, and have the responsible agent consume it on its next run, with proof that it did |
| G4 | Track follow-up actions that come out of findings |
| G5 | Add a new agent without code changes |
| G6 | Run at zero recurring cost |
| G7 | Anyone can run their own instance on their own accounts, without sharing data or secrets (ADR-0007) |

### 1.3 Non-goals (for now)

- General personal productivity features (tasks, notes, calendar). The data model leaves room for them; they are out of scope until the agent loop is used daily. See [roadmap](roadmap.md).
- Multi-user support.
- Agents writing directly into the application. See ADR-0001.

### 1.4 Quality goals, in priority order

1. **Correctness of state.** A run is never lost, never ingested twice, and feedback is never applied twice.
2. **Visible failure.** A missing run or a failed sync is shown, never silently skipped.
3. **Security.** Only the owner can read the data; content written by agents is treated as untrusted.
4. **Low maintenance.** Managed services only, no servers to patch.
5. **Self-hostable.** No personal values in code; setup by configuration only.
6. **Extensibility.** New agents and new item kinds through configuration and contract, not code.

## 2. Constraints

| Constraint | Consequence |
|---|---|
| Agents run in Anthropic's cloud behind an outbound network allowlist | Agents cannot be assumed to reach a custom HTTPS endpoint. Integration goes through a connector they already have: Google Drive. |
| The agents' Drive connector can create files but cannot overwrite them | Agents write one new file per run. Feedback to agents lives in a file the application maintains. |
| Vercel Hobby plan | Personal, non-commercial use. Cron jobs run at most once per day and may fire anywhere within the scheduled hour. |
| Neon Free plan | 1 GB storage and 100 CU-hours per project per month. Compute scales to zero when idle, so expect cold starts. |
| Google service accounts have no Drive storage quota | The service account cannot create files in a personal My Drive. It can read files in a folder shared with it and update files that the owner created. |

## 3. Context

```
                   +-------------------------+
                   |  Owner (any device)     |
                   +-----------+-------------+
                               | HTTPS, Google sign-in
                               v
+------------------+   Drive API (service account)   +------------------------+
| Google Drive     | <-------------------------------> | readmyagent on Vercel |
| folder           |   read run files                  |  Next.js app          |
| "Claude-agents"  |   update feedback.json            |  + Neon Postgres      |
+--------+---------+                                   +------------------------+
         ^
         | Drive connector: create run files, read feedback.json
         |
+--------+----------------------+
| Scheduled Claude agents       |
| Mail-triage, LocalChat-wachter|
| Weekbrief, future agents      |
+-------------------------------+
```

External systems:

| System | Role | Interface |
|---|---|---|
| Scheduled Claude agents | Produce run files, consume feedback | Google Drive connector |
| Google Drive | Exchange medium and long-term archive | Drive API v3 |
| Google Identity | Owner sign-in | OAuth 2.0 / OpenID Connect via Auth.js |
| Neon | Application database | Postgres over TLS |
| Vercel | Hosting, functions, daily cron | Git-based deployment |

## 4. Solution strategy

1. **Pull, do not push.** Agents keep writing to Drive exactly as today. The application pulls from Drive. This removes any dependency on agent network access and keeps Drive as the archive of record. (ADR-0001)
2. **Structured contract next to human log.** Every run writes a machine-readable JSON file next to its Markdown log. The application ingests JSON only; Markdown is linked for reading. (ADR-0004)
3. **Feedback through one application-owned file.** The application writes all pending feedback into `feedback.json` in the same Drive folder. Agents read it at the start of a run and report which feedback IDs they consumed in their run JSON. The application then marks those as consumed. The loop closes without agents ever writing to the application. (ADR-0005)
4. **Database is a projection plus owner state.** Runs and items are a projection of Drive and can be rebuilt by re-ingesting. Feedback, actions and item states are owned by the database and are the only data that must be backed up.
5. **Expected runs come from configuration.** Each agent has a declared schedule. Health is computed by comparing expected against ingested runs, so a missing run is a first-class signal.

## 5. Building blocks

```
readmyagent
├── app/                    Next.js routes (UI and route handlers)
│   ├── (reader)/           Inbox, run detail, item detail, actions, health
│   └── api/
│       ├── sync/           POST: manual sync (owner session)
│       └── cron/sync/      GET: Vercel cron entry point (cron secret)
├── lib/
│   ├── drive/              Drive client: list, download, update feedback.json
│   ├── ingest/             Parse and validate run JSON, upsert runs and items
│   ├── feedback/           Build and publish feedback.json, reconcile consumption
│   ├── health/             Expected-run calculation and health status
│   ├── db/                 Drizzle schema, migrations, queries
│   ├── agents/             Register and change agents, schedule checks, self-registration
│   ├── items/              Item state machine
│   ├── reader/             Read queries for the reader UI
│   ├── auth/               Auth.js config and owner allowlist
│   └── contract/           Zod mirrors of /schemas, kept in parity by tests
└── schemas/                JSON Schemas for the agent contract (source of truth)
```

| Block | Responsibility | Depends on |
|---|---|---|
| Drive client | List, download and update `feedback.json` over the Drive v3 REST API; retries on 429, 5xx and network errors; 2 MB limit per run file | `google-auth-library` and `@vercel/oidc` for the service account through Workload Identity Federation (ADR-0008). The full `googleapis` package is not needed for three calls |
| Ingest | Find new run files, validate against contract, idempotent upsert, record errors | Drive client, contract, db |
| Feedback publisher | Serialize pending and published feedback to `feedback.json`, validated against the contract; publishes serialized by a Postgres advisory lock | Drive client, db |
| Feedback reconciler | Mark feedback consumed based on `feedback_consumed` in ingested runs | db |
| Health | Compute expected runs per agent from cron schedule, flag missing and failed | db, agent config |
| Reader UI | Inbox of open items, run timeline, item detail with feedback form, actions list, health view | db, auth |
| Auth | Google sign-in, allowlist of one email, session handling | Auth.js |

## 6. Runtime scenarios

### 6.1 Ingestion

Triggers: opening the app when the last sync is older than 5 minutes, the manual "Sync" button, and the daily Vercel cron.

1. Acquire a sync lock (row in `sync_runs` with status `running`, enforced by a partial unique index). A lock older than 10 minutes is closed as `failed` first.
2. List files in the Drive folder with `modifiedTime` after the last successful sync minus a 1-day overlap. A manual sync lists the whole folder, which also backfills older files.
3. For each `*.json` run file (not `feedback.json`) not yet in `runs` by Drive file ID: download, validate against the contract version it declares. The Markdown log named in `log_file` is linked by its Drive ID when it is in the same listing. A failed download becomes an ingest error and the sync continues; the error is resolved automatically when the file is ingested later.
   - Markdown fallback ([ADR-0012](adr/0012-markdown-fallback-ingest.md)): after the JSON files, each Markdown log whose name matches a known run pattern and that is not yet a run or a linked log becomes a run with `source = 'markdown'`. Agent and time come from the file name (Europe/Amsterdam) and `createdTime`; the body is stored and a few fields are extracted. What cannot be read gives `parse_status = 'partial'`, never a dropped run. A JSON run for the same log wins: it replaces the Markdown run and keeps the link.
4. Valid: upsert run and items in one transaction. Items are deduplicated by `(agent, fingerprint)`; a repeated finding links to the existing item instead of creating a new one.
5. Invalid: store an `ingest_errors` row with the file ID and validation message. Never drop silently.
6. Reconcile feedback: for each ingested run, mark listed feedback IDs as `consumed`.
7. Publish `feedback.json` when feedback was consumed or is pending.
8. Release the lock and store counts. Status `ok`, `partial` (some files or the publish failed) or `failed` (Drive could not be listed). Health is computed when it is read.

Idempotency: the Drive file ID is the natural key. Re-running ingestion over the same files changes nothing.

### 6.2 Feedback loop

1. Owner marks an item, for example "not spam, keep this sender", or adds a rule for an agent.
2. Feedback row is created with status `pending`. The owner can withdraw it until an agent consumes it.
3. Right after the change, and on every sync while feedback is pending or was consumed, the publisher regenerates `feedback.json` with all `pending` and `published` feedback for all agents, plus `consumed` standing feedback (ADR-0010), and updates the file in Drive. Rows become `published`. The file is written inside the database transaction: if the write fails, rows stay `pending` and the next publish retries. If the write succeeds and the commit fails, the next publish writes the same entries again, which is harmless because agents apply entries idempotently.
4. On its next run, the agent reads `feedback.json`, applies entries addressed to it, and lists the applied IDs in `feedback_consumed` in its run JSON.
5. Ingestion marks those rows `consumed` and links them to the run. One-off feedback leaves the next `feedback.json`; standing feedback stays until the owner withdraws it (ADR-0010).
6. Feedback that stays `published` across two expected runs of its agent is flagged in the health view. This catches an agent that ignores feedback.

### 6.3 Missing run detection

For every active agent, the health module expands the agent's cron expression over the last 14 days, applies a grace window (default 3 hours), and matches each expected slot to an ingested run. Unmatched slots are shown as `missing`. Runs with status `failed` or a failed verification (`verification.result` is `issues`) are shown as `failed`.

Details:

- The schedule's `CRON_TZ=` prefix sets the timezone, so slots follow daylight saving time. Without a prefix, `APP_TIMEZONE` applies.
- A run matches a slot when it starts between 15 minutes before the slot and the end of the grace window. Each run fills one slot, earliest open slot first.
- A slot whose grace window has not ended yet and has no run is `pending`, not `missing`. With the default grace window, a skipped run shows as `missing` 3 hours after its slot.
- Slots before the agent was registered are not expected.
- Runs that match no slot, such as a manual run, are listed as unscheduled.
- The agent's status is the status of its most recent due slot.
- An invalid schedule is reported as `invalid_schedule` for that agent; it does not break health for the other agents.

## 7. Deployment

| Component | Where | Notes |
|---|---|---|
| Application | Vercel Hobby, production branch `main` | Preview deployments per pull request |
| Database | Neon Free, region closest to the Vercel function region (EU) | Separate Neon branch for previews |
| Secrets | Vercel environment variables of the instance owner, marked Sensitive | Never in the repository. No Google key: Drive access through Workload Identity Federation. See [operations](operations.md) |
| Cron | `vercel.json`, once per day | Hobby limit; manual and on-open sync cover the rest |
| Drive folder | Owner's My Drive, shared with the service account as Editor | `feedback.json` created once by the owner |
| Instances | One per user, on the user's own accounts | Updated by merging release tags (ADR-0007) |

## 8. Cross-cutting concepts

- **Validation at the edge.** Every external input (Drive files, form posts, cron calls) is validated with Zod before it reaches the database.
- **Untrusted content.** Agent output can contain text from emails, web pages and repositories. It is rendered as sanitized Markdown with raw HTML disabled, links set to `rel="noopener noreferrer nofollow"`, and never executed or interpolated into SQL or prompts. See [SECURITY.md](../SECURITY.md).
- **Time.** Store UTC (`timestamptz`), display Europe/Amsterdam.
- **Observability.** Structured JSON logs from route handlers; every sync writes a `sync_runs` row with counts and errors, visible in the UI.
- **Configuration as data.** Agents are rows in the `agents` table, managed by the owner in the app. Nothing instance-specific lives in code.
- **Fail closed on configuration.** `proxy.ts` validates the environment on every request (`lib/config`). With a missing or invalid required value, every page is rewritten to `/setup` and every API route answers 503. The setup page lists setting names and statuses, never values. Application code reads configuration only through `getConfig()`.
- **Per-environment requirements.** Production needs Drive and `CRON_SECRET`. Previews and local development may run without them: sync and cron are then disabled. A partial Drive configuration is always invalid.
- **Security headers.** Static headers in `next.config.ts`; the Content Security Policy with a per-request nonce in `proxy.ts`. All pages render per request so the nonce can be applied.

## 9. Architecture decisions

See the [ADR log](adr/README.md).

## 10. Risks and technical debt

| ID | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Agents do not reliably produce valid JSON | High (happened: no JSON until 2026-11-28) | High | Strict schema with versioning; ingest errors visible in UI; pasteable agent instructions with schema and self-check (docs/contracts/agent-instructions.md); Markdown fallback ingest keeps runs visible (ADR-0012) |
| R2 | Service account approach breaks because Google changes Drive quota rules again | Low | Medium | Only update operations on an owner-created file; fallback is OAuth as the owner with a stored refresh token |
| R3 | `feedback.json` becomes an injection channel into agents | Low | High | Only the authenticated owner creates feedback; schema restricts types; agents instructed to treat entries as data within a fixed set of actions |
| R4 | Vercel Hobby cron fires once per day, late within the hour | High | Low | On-open sync and manual sync; health uses a grace window |
| R5 | Neon cold starts make first page load slow | High | Low | Acceptable for single user; show loading state |
| R6 | Scope creep into a general productivity app before the agent loop is proven | Medium | Medium | Phase gate in roadmap: phase 2 only starts after 4 weeks of daily use |
| R7 | Lock-in on Vercel or Neon | Low | Low | Standard Next.js and Postgres; Drizzle migrations are portable |
| R8 | Setup in Google Cloud is too hard for a new user | Medium | Medium | Setup script, setup page and step-by-step operations guide |
| R10 | Auth.js v5 is still a beta release (5.0.0-beta.32, July 2026) | Medium | Medium | Exact version pinned; access rules live in our own tested `lib/auth/policy.ts` and the proxy decodes the session itself, so a replacement library only changes `lib/auth/auth.ts` |
| R9 | Compromised upstream code reaches every instance | Low | High | Protected `main`, pinned CI actions, tagged releases, owners merge releases themselves. See SECURITY.md T11 |
| R11 | Google classifies readmyagent as an AI access tool under the Workspace AI Tools Addendum: Drive REST access blocked from 2027-02-01, indefinite run retention not allowed | Low | Medium | ADR-0011: owner checks the Addendum and the usage dashboard before 2027-02-01; any in-app language model on Workspace data requires an ADR moving Drive access to MCP first |

## 11. Glossary

| Term | Meaning |
|---|---|
| Agent | A scheduled Claude task that writes run files |
| Run | One execution of an agent, represented by one run JSON file |
| Item | One finding inside a run that may need attention |
| Fingerprint | Stable key of an item across runs, used for deduplication |
| Feedback | Owner input addressed to an agent, delivered through `feedback.json` |
| Action | A follow-up task for the owner, optionally linked to an item |
| Expected run | A schedule slot in which a run should have appeared |
