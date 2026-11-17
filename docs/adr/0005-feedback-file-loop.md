# ADR-0005: Feedback to agents through an application-owned feedback.json

- Status: Accepted
- Date: 2026-11-17

## Context

Feedback must reach the agents on their next run, and the owner wants proof it was applied. Agents can read Drive files but cannot overwrite them, and cannot call the application (ADR-0001).

## Options

1. Owner edits a per-agent state file by hand (current situation).
2. One `feedback.json` in the Drive folder, maintained by the application, read by all agents. Agents report consumed IDs in their run JSON.
3. One feedback file per agent.

## Decision

Option 2. A single file keeps the Drive folder simple and makes publishing one atomic update. Each entry carries an `agent` field. Agents acknowledge consumption through `feedback_consumed`; the reader marks entries consumed on ingestion and drops them from the next publish.

## Consequences

- Closed loop with an audit trail: every feedback entry links to the run that consumed it.
- An entry may be seen more than once before it is reconciled, so applying feedback must be idempotent. Stated in the contract.
- Feedback still published after two expected runs of its agent is flagged, which detects agents ignoring feedback.
- The file is an instruction channel into agents. Mitigations in SECURITY.md: owner-only authorship, closed set of types, agents treat `note` as intent within their own rules.
- The existing `mail-triage-state.md` remains the place for the agent's base rules. Feedback refines them; it does not replace them.
