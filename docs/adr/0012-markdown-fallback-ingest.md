# ADR-0012: Markdown fallback ingest for agents without a JSON run file

- Status: Accepted
- Date: 2026-11-28
- Amends: [ADR-0004](0004-json-run-contract.md)

## Context

ADR-0004 made the JSON run file the only input the reader ingests. In practice the agents never wrote one.

Facts, checked on 2026-11-28:

- The Drive folder `Claude-agents` holds 33 files: 28 Markdown run logs (`mail-triage-run-YYYY-MM-DD-HHMM.md`, `localchat-wachter-run-YYYY-MM-DD.md`, `weekbrief-run-YYYY-wWW.md`, from 2026-11-17 on), `mail-triage-state.md`, three legacy `*-log.md` files and `feedback.json`. There is no run JSON file.
- The sync lists every file in the folder, then keeps only `*.json` other than `feedback.json` (`lib/sync/run-sync.ts`). Every Markdown log was listed and dropped, so the app showed no runs.
- Drive access in production works: `feedback.json` was last written by the app on 2026-11-20 16:46 UTC.
- Listing is incremental (files modified after the last successful sync minus one day). A fixed filter alone would never see the older logs again.

## Options

1. Keep JSON only and wait for the agents to be updated. Pro: one input format. Con: the app stays empty until every prompt is fixed, and any later run that fails to write JSON disappears again.
2. Parse Markdown fully, with heuristics or an LLM. Pro: rich data. Con: the fragility ADR-0004 rejected.
3. Ingest the Markdown log as a run with minimal, robust extraction, and let JSON win when both exist. Pro: every run is visible today and stays visible when JSON is missing. Con: Markdown runs carry no items, so the inbox stays fed by JSON only.

## Decision

Option 3, as a permanent fallback next to the JSON contract.

- Only Markdown files whose name matches one of the three run patterns are ingested. `mail-triage-state.md`, `feedback.json` and `*-log.md` are ignored.
- Agent and run time come from the file name, in Europe/Amsterdam. Names without a minute (wachter, weekbrief) take the start from the Drive `createdTime` when it falls inside the named day or week, so two runs on one day sort correctly. The finish is the `createdTime`.
- The full Markdown body is stored (`runs.markdown`) and rendered with `SafeMarkdown`. Extraction is limited to the four header lines of the wachter (`main_commit`, `open_prs`, `ci_main`, `kwetsbaarheden`) and the counts of mail-triage, which become metrics. A run whose fields cannot be read is stored with `parse_status = 'partial'`, never dropped.
- Idempotent on the Drive file ID. Two logs with the same name are both kept; the later one gets a numbered `run_id` suffix.
- JSON wins. JSON run files are processed first in each sync; a Markdown log named in a JSON run's `log_file` is only linked. When the JSON arrives after its Markdown run was ingested, the Markdown run is replaced in the same transaction and the log stays linked.
- An unknown agent is registered from a fixed table of the three known agents (name and schedule), the same path ADR-0009 uses for JSON runs.
- A manual sync lists the whole folder instead of the incremental window, so a backfill is one click on "Sync". Cron and on-open syncs stay incremental.

## Consequences

- Runs from 2026-11-17 on become visible per agent, with health, without changing any agent.
- Markdown runs have no items and consume no feedback. Feedback consumption keeps depending on JSON (`feedback_consumed`), so agents still need the JSON contract: [docs/contracts/agent-instructions.md](../contracts/agent-instructions.md).
- The three file name patterns and agent defaults live in `lib/ingest/markdown.ts`. A new agent without JSON needs a code change there; with JSON it registers itself (ADR-0009).
- The reader only reads Drive for this. The service account does not need Editor on the folder: Viewer on the folder plus Editor on `feedback.json` is enough.
