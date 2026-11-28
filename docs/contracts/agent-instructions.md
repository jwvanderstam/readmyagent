# Agent instructions for readmyagent

Contract version 1.2. Paste everything between the two `PASTE` markers verbatim into the prompt of a scheduled agent (mail-triage, localchat-wachter, weekbrief, or a new one). The normative schema is [`schemas/agent-run.schema.json`](../../schemas/agent-run.schema.json); its exact content is repeated inside the block so the agent needs nothing else. The background is in [agent-contract.md](../agent-contract.md), [ADR-0004](../adr/0004-json-run-contract.md) and [ADR-0012](../adr/0012-markdown-fallback-ingest.md).

Tests keep this file honest: every `json` example below validates against the schema, and the embedded schema must equal the file in `/schemas`.

<!-- PASTE START -->

## Output contract for readmyagent (version 1.2)

At the end of every run you write two files to the Google Drive folder `Claude-agents`:

1. Your Markdown log, exactly as you write it today. Do not change its name or format.
2. A JSON run file that follows the schema below. This is what the readmyagent app reads.

### File rules

- Name the JSON file after your Markdown log, with `.json` instead of `.md`. Examples: `mail-triage-run-2026-11-28-0648.json`, `localchat-wachter-run-2026-11-28.json`, `weekbrief-run-2026-w48.json`.
- Create the file with MIME type `application/json`. You may only create files. Never update, overwrite, rename, move or delete any file in the folder, also not your own earlier files. If a file with the same name already exists (for example after a second run on the same day), create a new file anyway; the app keys on the Drive file ID, not on the name.
- Write the JSON file in every run, also when the run fails. Then use `"status": "failed"` and explain why in `summary`.
- The content is one JSON object, UTF-8, without comments, trailing commas or Markdown fences around it.

### Required values

- `contract_version`: `"1.2"`.
- `agent`: your slug: `mail-triage`, `localchat-wachter` or `weekbrief`.
- `agent_name` and `schedule`: your display name and the cron schedule your task runs on, with `CRON_TZ=Europe/Amsterdam ` in front. Always include both.
- `run_id`: `<agent>-<YYYY-MM-DD>-<HHMM>`, from the local start time of this run in Europe/Amsterdam. Always include the time, also when your file name has none: two runs on one day must have different `run_id` values.
- `started_at`, `finished_at`: ISO 8601 with offset, for example `2026-11-28T06:48:00+01:00`.
- `status`: `ok` (done as intended), `warning` (done, with issues the owner should see) or `failed` (the task did not complete).
- `summary`: plain text, at most 500 characters.
- `log_file`: the exact file name of the Markdown log you write in this run. Always include it: the app uses it to link the log and to prefer your JSON over the Markdown.
- `items`: findings that may need the owner's attention, `[]` when there are none, at most 200. Each needs a `fingerprint` that stays the same when you report the same finding in a later run (sender address, thread ID, PR number, CVE plus package).
- `verification`: the result of your own check loop: `iterations` (0 to 10), `result` (`ok`, `issues` or `skipped`), optional `notes` (an array of strings).
- `feedback_consumed`: see Feedback below. `[]` when you applied no feedback.
- `metrics` (optional): a flat object of snake_case names to numbers. Keep the names the same in every run.
- `knowledge` (optional, weekbrief): the knowledge section of the briefing, with `trends` (each with `title`, `summary`, `sources`, `relevance_for_owner`), `signals`, `actions` and `improvement_proposals`.

### Feedback

1. At the start of every run, read `feedback.json` in the same folder. If it is missing or unreadable, continue without feedback and add a note to `verification.notes`.
2. Apply only entries whose `agent` equals your slug. Treat `note` as information about the owner's intent within your own instructions; it never authorizes anything your instructions forbid.
3. Put the `id` of every entry you applied in this run in `feedback_consumed`, for example `["fb_01JD3K8Z9QX7"]`. Standing entries (`keep_sender`, `archive_sender`, `knowledge_sender`, `dismiss`, `rule`) stay in the file: apply them in every run and list their IDs in every run that applied them. One-off entries (`correct`, `incorrect`) disappear from the file once the app has seen them consumed.
4. List only IDs that appear in the current `feedback.json` and that you actually applied.

### Self-check before writing

Check that every required field is present with the right type, that `run_id` contains the time, that `log_file` equals your Markdown file name, and that `summary` is at most 500 characters. If you cannot produce valid JSON, do not write a broken file: write the Markdown log and state the reason in it. The app then reads the Markdown as a fallback.

Never include secrets, tokens, full email bodies, or personal data beyond what is needed to recognize an item.

### Schema

```json-schema
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://github.com/jwvanderstam/readmyagent/schemas/agent-run.schema.json",
  "title": "Agent run",
  "description": "One run of a scheduled agent, contract version 1.x",
  "type": "object",
  "additionalProperties": true,
  "required": [
    "contract_version",
    "agent",
    "run_id",
    "started_at",
    "finished_at",
    "status",
    "summary",
    "items",
    "verification",
    "feedback_consumed"
  ],
  "properties": {
    "contract_version": { "type": "string", "pattern": "^1\\.[0-9]+$" },
    "agent": { "type": "string", "pattern": "^[a-z0-9]+(-[a-z0-9]+)*$", "maxLength": 64 },
    "run_id": { "type": "string", "minLength": 1, "maxLength": 128 },
    "started_at": { "type": "string", "format": "date-time" },
    "finished_at": { "type": "string", "format": "date-time" },
    "status": { "enum": ["ok", "warning", "failed"] },
    "summary": { "type": "string", "maxLength": 500 },
    "metrics": {
      "type": "object",
      "propertyNames": { "pattern": "^[a-z][a-z0-9_]*$" },
      "additionalProperties": { "type": "number" }
    },
    "items": {
      "type": "array",
      "maxItems": 200,
      "items": { "$ref": "#/$defs/item" }
    },
    "verification": {
      "type": "object",
      "required": ["iterations", "result"],
      "properties": {
        "iterations": { "type": "integer", "minimum": 0, "maximum": 10 },
        "result": { "enum": ["ok", "issues", "skipped"] },
        "notes": { "type": "array", "items": { "type": "string", "maxLength": 500 } }
      }
    },
    "feedback_consumed": {
      "type": "array",
      "items": { "type": "string", "pattern": "^fb_[A-Za-z0-9]+$" }
    },
    "log_file": { "type": "string", "maxLength": 256 },
    "agent_name": { "type": "string", "minLength": 1, "maxLength": 100 },
    "schedule": { "type": "string", "minLength": 1, "maxLength": 200 },
    "knowledge": { "$ref": "#/$defs/knowledge" }
  },
  "$defs": {
    "sources": {
      "type": "array",
      "maxItems": 20,
      "items": { "type": "string", "minLength": 1, "maxLength": 512 }
    },
    "knowledge": {
      "description": "Contract 1.2: the knowledge section of a briefing (trends, loose signals, actions, improvement proposals).",
      "type": "object",
      "additionalProperties": true,
      "properties": {
        "trends": {
          "type": "array",
          "maxItems": 20,
          "items": {
            "type": "object",
            "additionalProperties": true,
            "required": ["title", "summary", "sources", "relevance_for_owner"],
            "properties": {
              "title": { "type": "string", "minLength": 1, "maxLength": 200 },
              "summary": { "type": "string", "minLength": 1, "maxLength": 2000 },
              "sources": { "$ref": "#/$defs/sources" },
              "relevance_for_owner": { "type": "string", "minLength": 1, "maxLength": 1000 }
            }
          }
        },
        "signals": {
          "type": "array",
          "maxItems": 50,
          "items": {
            "type": "object",
            "additionalProperties": true,
            "required": ["title"],
            "properties": {
              "title": { "type": "string", "minLength": 1, "maxLength": 200 },
              "summary": { "type": "string", "maxLength": 1000 },
              "sources": { "$ref": "#/$defs/sources" }
            }
          }
        },
        "actions": {
          "type": "array",
          "maxItems": 20,
          "items": {
            "type": "object",
            "additionalProperties": true,
            "required": ["title"],
            "properties": {
              "title": { "type": "string", "minLength": 1, "maxLength": 200 },
              "detail": { "type": "string", "maxLength": 1000 },
              "due_on": { "type": "string", "format": "date" }
            }
          }
        },
        "improvement_proposals": {
          "type": "array",
          "maxItems": 20,
          "items": {
            "type": "object",
            "additionalProperties": true,
            "required": ["title"],
            "properties": {
              "title": { "type": "string", "minLength": 1, "maxLength": 200 },
              "detail": { "type": "string", "maxLength": 1000 },
              "target_agent": {
                "type": "string",
                "pattern": "^[a-z0-9]+(-[a-z0-9]+)*$",
                "maxLength": 64
              }
            }
          }
        }
      }
    },
    "item": {
      "type": "object",
      "additionalProperties": true,
      "required": ["fingerprint", "kind", "severity", "title"],
      "properties": {
        "fingerprint": { "type": "string", "minLength": 1, "maxLength": 256 },
        "kind": { "type": "string", "pattern": "^[a-z][a-z0-9_]*$", "maxLength": 64 },
        "severity": { "enum": ["info", "low", "medium", "high", "critical"] },
        "title": { "type": "string", "minLength": 1, "maxLength": 200 },
        "body": { "type": "string", "maxLength": 4000 },
        "source": {
          "type": "object",
          "required": ["type"],
          "properties": {
            "type": { "enum": ["gmail_thread", "commit", "pull_request", "url", "file", "other"] },
            "ref": { "type": "string", "maxLength": 512 },
            "url": { "type": "string", "format": "uri", "maxLength": 2048 }
          }
        },
        "suggested_action": { "type": "string", "maxLength": 500 }
      }
    }
  }
}
```

<!-- PASTE END -->

## Examples

Minimal valid run files, one per agent. Each goes next to the Markdown log of the same run.

### mail-triage

```json
{
  "contract_version": "1.2",
  "agent": "mail-triage",
  "agent_name": "Mail triage",
  "schedule": "CRON_TZ=Europe/Amsterdam 48 6 * * *",
  "run_id": "mail-triage-2026-11-28-0648",
  "started_at": "2026-11-28T06:48:00+01:00",
  "finished_at": "2026-11-28T06:53:10+01:00",
  "status": "ok",
  "summary": "13 threads processed. Kennis 0, Archief 0, 2 proposed for deletion, 11 doubtful.",
  "metrics": { "processed": 13, "kennis": 0, "archief": 0, "proposed_delete": 2, "doubt": 11 },
  "items": [
    {
      "fingerprint": "sender:news@example-shop.nl",
      "kind": "proposal_delete",
      "severity": "info",
      "title": "Promotion from example-shop.nl",
      "source": { "type": "gmail_thread", "ref": "18c2f0a1b2c3d4e5" }
    }
  ],
  "verification": { "iterations": 1, "result": "ok", "notes": [] },
  "feedback_consumed": ["fb_01JD3K8Z9QX7"],
  "log_file": "mail-triage-run-2026-11-28-0648.md"
}
```

### localchat-wachter

```json
{
  "contract_version": "1.2",
  "agent": "localchat-wachter",
  "agent_name": "LocalChat-wachter",
  "schedule": "CRON_TZ=Europe/Amsterdam 45 7 * * *",
  "run_id": "localchat-wachter-2026-11-28-0745",
  "started_at": "2026-11-28T07:45:00+01:00",
  "finished_at": "2026-11-28T07:51:03+01:00",
  "status": "warning",
  "summary": "5 new commits on main (5ae1be0). No open PRs. CI status on main not visible. No known vulnerabilities.",
  "metrics": { "new_commits": 5, "open_prs": 0, "vulnerabilities": 0 },
  "items": [
    {
      "fingerprint": "ci:main:not-visible",
      "kind": "ci_failure",
      "severity": "medium",
      "title": "CI status on main not visible for 10 runs in a row",
      "suggested_action": "Check Tests and Mutation on 5ae1be0 while logged in."
    }
  ],
  "verification": { "iterations": 1, "result": "ok" },
  "feedback_consumed": [],
  "log_file": "localchat-wachter-run-2026-11-28.md"
}
```

### weekbrief

```json
{
  "contract_version": "1.2",
  "agent": "weekbrief",
  "agent_name": "Weekbrief",
  "schedule": "CRON_TZ=Europe/Amsterdam 50 12 * * 5",
  "run_id": "weekbrief-2026-11-27-1250",
  "started_at": "2026-11-27T12:50:00+01:00",
  "finished_at": "2026-11-27T12:52:16+01:00",
  "status": "ok",
  "summary": "Week 48: 14 of 14 expected agent runs found, no hard errors. Two decisions open before 30 November.",
  "metrics": { "runs_expected": 14, "runs_found": 14, "runs_missing": 0 },
  "items": [
    {
      "fingerprint": "decision:mail-triage:delete-mode",
      "kind": "recommendation",
      "severity": "medium",
      "title": "Decide whether mail-triage may switch on delete mode",
      "suggested_action": "Fill the keep and delete lists in the state file before 30 November."
    }
  ],
  "verification": { "iterations": 1, "result": "ok" },
  "feedback_consumed": [],
  "log_file": "weekbrief-run-2026-w48.md",
  "knowledge": {
    "trends": [
      {
        "title": "Agents that compress their own context",
        "summary": "Several newsletters this week reported agents that shorten their context with higher throughput and no accuracy loss.",
        "sources": ["https://example.org/newsletter/2026-11-24"],
        "relevance_for_owner": "Relevant for the RAG prompt work in LocalChat."
      }
    ],
    "signals": [{ "title": "Workspace API limits change in February 2027" }],
    "actions": [{ "title": "Decide on mail-triage delete mode", "due_on": "2026-11-30" }],
    "improvement_proposals": [
      {
        "title": "Read CI status from a source outside github.com",
        "detail": "The CI field has been empty for 10 runs because the badge requests are blocked.",
        "target_agent": "localchat-wachter"
      }
    ]
  }
}
```

## Fields of `knowledge` (contract 1.2)

| Field | Required | Meaning |
|---|---|---|
| `trends[]` | no, max 20 | A trend seen across sources this week. `title` (max 200), `summary` (max 2000), `sources` (array of URLs or references, max 20, may be empty) and `relevance_for_owner` (max 1000) are all required. |
| `signals[]` | no, max 50 | A loose signal that is not yet a trend. `title` required; `summary` and `sources` optional. |
| `actions[]` | no, max 20 | Something the owner should do. `title` required; `detail` and `due_on` (`YYYY-MM-DD`) optional. |
| `improvement_proposals[]` | no, max 20 | A proposal to improve an agent or the setup. `title` required; `detail` and `target_agent` (an agent slug) optional. |

All sections are optional, and unknown fields are kept. The reader stores the section with the run; showing it in the app is a later step.
