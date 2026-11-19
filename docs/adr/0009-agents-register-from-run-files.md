# ADR-0009: Agents register and update themselves from their run files

- Status: Accepted
- Date: 2026-11-20

## Context

Since ADR-0007, the owner registers every agent in the app by hand: slug, name and schedule. The same values already exist in the scheduled task in Claude. Keeping two copies means a new task stays invisible until the owner adds it, and a changed schedule in Claude makes health report missing runs until the owner edits the app.

Facts:

- To our knowledge, Claude has no API through which an outside app can list a user's scheduled tasks. Even if it had, the app would need access to the owner's Claude account, which the security model avoids (SECURITY.md T6).
- Every agent already writes a run file to the Drive folder on every run (ADR-0004). The contract allows minor versions that add optional fields (agent contract section 5).
- Only the owner and the service account can write to the Drive folder (SECURITY.md T4).

## Options

1. **Keep manual registration.** No change. Duplicate data, and new or changed tasks drift from the app.
2. **Read scheduled tasks from Claude.** Not available, and it would add a credential for the owner's Claude account.
3. **Agents describe themselves in their run files.** Contract 1.1 adds optional `agent_name` and `schedule`. Ingestion registers an unknown agent that declares a usable schedule, and updates name and schedule of a known agent from its newest run.

## Decision

Option 3. An unknown agent is registered when its run file declares a schedule that health can use (valid cron, known timezone, at most hourly) and fewer than 20 agents exist. A known agent takes name and schedule from its newest run; an older file ingested late changes nothing, and an unusable declared schedule is ignored. Manual registration in the app stays available for agents that do not declare themselves.

## Consequences

- New scheduled tasks appear in the app after their first run, without a manual step. Changes to a task's schedule reach health with the next run.
- What the agent declares wins: a schedule edited in the app is overwritten by the next run that declares one. Active or inactive stays the owner's choice, as does the grace window.
- A run file with an unknown slug and no usable schedule is still an ingest error, as before.
- Anyone who can write to the Drive folder can now create agents, not only runs. The folder stays restricted to the owner and the service account, and the limit of 20 agents caps the effect of forged files (SECURITY.md T4).
- Agent prompts must write `agent_name` and `schedule` and keep the schedule in sync with the task. The prompt template in `docs/operations.md` section 5 says so.
