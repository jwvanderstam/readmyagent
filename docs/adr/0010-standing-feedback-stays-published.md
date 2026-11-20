# ADR-0010: Standing feedback stays in feedback.json until withdrawn

- Status: Accepted
- Date: 2026-11-20

## Context

ADR-0005 drops every entry from `feedback.json` once an agent reports it in `feedback_consumed`. That fits one-off feedback (`correct`, `incorrect`): the agent learns from it once. It does not fit standing feedback (`keep_sender`, `archive_sender`, `knowledge_sender`, `dismiss`, `rule`), which must hold on every run.

Facts:

- Agents run as scheduled tasks in Claude and start every run fresh. They have no state of their own between runs; what they know comes from their prompt and the files they read (ADR-0001, agent contract section 3.3).
- So once a standing entry left the file, the agent forgot it on the next run: a sender marked `keep_sender` could be proposed for deletion again.
- Withdraw was only possible before consumption, so the owner had no way to end a rule the agent had already applied.

## Options

1. **Keep ADR-0005 as is.** Standing feedback works for one run only.
2. **Agents keep their own memory of standing feedback.** Needs state in Drive that the agent writes, which the pull model avoids (ADR-0001), and two copies that can drift.
3. **Standing feedback stays in the file after consumption.** Consumed standing entries are published until the owner withdraws them. One-off entries leave as before.

## Decision

Option 3. `keep_sender`, `archive_sender`, `knowledge_sender`, `dismiss` and `rule` stay in `feedback.json` with status `consumed` until the owner withdraws them, and can be withdrawn in any open or consumed state. `correct` and `incorrect` leave the file once consumed and cannot be withdrawn after that.

## Consequences

- Standing feedback holds on every run. The agent sees the same entry each run, which the contract already allows: applying an entry again must be harmless (agent contract section 3.3).
- Withdraw is how a standing rule ends. The app offers it on consumed standing feedback.
- The consuming run recorded on a standing entry is the first one that applied it. Later runs that list it again change nothing, because ingestion only consumes published entries.
- `feedback.json` grows with the number of standing entries. At the expected volume of a single owner this stays small; watch it if it ever reaches hundreds of entries.
- The contract schema does not change; only which entries the file holds.
