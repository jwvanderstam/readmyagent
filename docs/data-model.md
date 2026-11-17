# Data model

Postgres on Neon, managed with Drizzle ORM. Migrations live in `drizzle/` and are generated, reviewed and committed; the database is never changed by hand.

## 1. Ownership

| Data | Source of truth | Can be rebuilt from Drive |
|---|---|---|
| `agents` | `config/agents.ts` (seeded) | Yes, from config |
| `runs`, `items` (content fields) | Drive run files | Yes, by re-ingesting |
| `items.state`, `feedback`, `actions` | Database | **No. Back up.** |
| `sync_runs`, `ingest_errors` | Database | Not needed |

## 2. Tables

### agents

| Column | Type | Notes |
|---|---|---|
| `slug` | text PK | Matches `agent` in run files |
| `name` | text | Display name |
| `schedule` | text | Cron expression with `CRON_TZ=` prefix, used for expected-run calculation |
| `grace_minutes` | int | Default 180 |
| `active` | boolean | Inactive agents are not checked for missing runs |
| `created_at` | timestamptz | |

### runs

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `agent_slug` | text FK agents | |
| `run_id` | text | From file; unique per agent |
| `drive_file_id` | text UNIQUE | Idempotency key |
| `log_file_id` | text null | Drive ID of the Markdown log, resolved by name |
| `contract_version` | text | |
| `started_at`, `finished_at` | timestamptz | |
| `status` | enum `ok`, `warning`, `failed` | |
| `summary` | text | |
| `metrics` | jsonb | |
| `verification` | jsonb | |
| `raw` | jsonb | Full original document, for re-processing |
| `ingested_at` | timestamptz | |

Unique: `(agent_slug, run_id)`.

### items

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `agent_slug` | text FK | |
| `fingerprint` | text | |
| `kind`, `severity`, `title`, `body`, `source`, `suggested_action` | | Latest values from the most recent occurrence |
| `state` | enum `open`, `acknowledged`, `done`, `dismissed` | Owner-managed |
| `first_seen_run_id`, `last_seen_run_id` | uuid FK runs | |
| `occurrences` | int | Count of runs that reported it |
| `created_at`, `updated_at` | timestamptz | |

Unique: `(agent_slug, fingerprint)`. A link table `item_occurrences (item_id, run_id)` keeps the full history.

### feedback

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | `fb_` + ULID, the ID agents see |
| `agent_slug` | text FK | |
| `item_id` | uuid FK null | Null for agent-wide rules |
| `type` | enum, see agent contract | |
| `target` | jsonb | |
| `note` | text | |
| `status` | enum `pending`, `published`, `consumed`, `withdrawn` | |
| `published_at`, `consumed_at` | timestamptz null | |
| `consumed_by_run` | uuid FK runs null | Proof of consumption |
| `created_at` | timestamptz | |

### actions

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `item_id` | uuid FK null | Actions can exist without an item |
| `title` | text | |
| `notes` | text | |
| `due_on` | date null | |
| `status` | enum `todo`, `doing`, `done`, `dropped` | |
| `created_at`, `updated_at`, `completed_at` | timestamptz | |

### sync_runs and ingest_errors

`sync_runs`: `id`, `trigger` (`cron`, `manual`, `on_open`), `started_at`, `finished_at`, `status` (`running`, `ok`, `partial`, `failed`), `files_seen`, `runs_ingested`, `errors`.

`ingest_errors`: `id`, `sync_run_id`, `drive_file_id`, `file_name`, `message`, `resolved_at`.

## 3. State machines

Item:

```
open -> acknowledged -> done
  \          \
   \          -> dismissed
    -> dismissed
any -> open   (reopened when it reappears after done, unless dismissed)
```

Feedback:

```
pending -> published -> consumed
   \           \
    -> withdrawn  -> withdrawn   (owner withdraws; removed from feedback.json at next publish)
```

Action: `todo -> doing -> done`, any state `-> dropped`.

## 4. Retention

- Runs and items: kept indefinitely. Estimated volume: 3 agents, about 15 runs per week, under 50 MB per year including `raw`. Well inside the 1 GB Neon Free limit.
- `sync_runs`: keep 90 days.
- Backups: weekly `pg_dump` of owner-owned tables (`items` state columns, `feedback`, `actions`) via a GitHub Action to a private artifact. Defined in phase 1.
