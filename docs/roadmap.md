# Roadmap

Phases are gated: a phase starts only when the exit criteria of the previous one are met.

## Phase 0: Foundations (done)

- Architecture, ADRs, agent contract with JSON Schemas, data model, standards, security model.
- Exit: documents reviewed and accepted by the owner.

## Phase 1: Agent loop MVP (current)

Scope:
- Next.js scaffold, CI (lint, typecheck, test), Vercel and Neon wired, Auth.js with owner allowlist, security headers.
- Drive client, ingestion with idempotency and ingest errors, sync on open, manual and daily cron.
- Reader UI: inbox of open items, run timeline per agent, item detail, health view with missing and failed runs.
- Feedback: create, publish to `feedback.json`, reconcile consumption.
- Actions: create from item or standalone, simple status list.
- Agent prompts updated for all three agents to write run JSON and consume feedback.
- Weekly backup job.

Exit criteria:
- All three agents produce valid run JSON for 7 consecutive days.
- At least 5 feedback entries consumed and visible with the consuming run.
- A deliberately skipped run shows as `missing` within one day.

## Phase 2: Daily use and refinement

Start only after 4 weeks of daily use of phase 1.

- Metrics charts per agent (trends from `metrics`).
- Decide whether the Weekbrief agent is still needed or becomes a reader view.
- Notifications (for example a daily digest or push) if the owner misses findings.
- Search and filters.

## Phase 3: Personal productivity (candidate scope)

Not committed. Candidates, to be decided with an ADR each:

- Own tasks and notes next to agent actions.
- Additional agents (for example calendar or bid deadlines).
- App as MCP connector (ADR-0001 option 2) for agents that need interactive access.
