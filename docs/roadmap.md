# Roadmap

Phases are gated: a phase starts only when the exit criteria of the previous one are met.

## Phase 0: Foundations (done)

- Architecture, ADRs, agent contract with JSON Schemas, data model, standards, security model.
- Exit: documents reviewed and accepted by the owner.

## Phase 1: Agent loop MVP (current: validation)

Build complete and released as v0.1.0 on 2026-11-20. The phase closes when the exit criteria below hold; until then, only fixes found in daily use land on `main`.

Scope:
- Next.js scaffold, CI (lint, typecheck, test), Vercel and Neon wired, Auth.js with owner allowlist, security headers.
- Self-hosting (ADR-0007): validated configuration with fail-closed setup page, agents managed in the app, Drive through Workload Identity Federation (ADR-0008), `gcloud` setup script, "Deploy to Vercel" button, first tagged release.
- Drive client, ingestion with idempotency and ingest errors, sync on open, manual and daily cron.
- Reader UI: inbox of open items, run timeline per agent, item detail, health view with missing and failed runs.
- Feedback: create, publish to `feedback.json`, reconcile consumption.
- Actions: create from item or standalone, simple status list.
- Agent prompts updated for all three agents to write run JSON and consume feedback. Owner task: the prompts live in the scheduled tasks, not in this repository (operations, section 5).
- Weekly backup job.

Exit criteria, checked in the app:
- [ ] All three agents produce valid run JSON for 7 consecutive days: no open entries on the ingest errors page, and every agent page shows no `missing` or `failed` run in that week.
- [ ] At least 5 feedback entries consumed and visible with the consuming run.
- [ ] A deliberately skipped run shows as `missing` within one day.

When all three hold, mark them here, record the date, and phase 2's four weeks of daily use start from it.

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
