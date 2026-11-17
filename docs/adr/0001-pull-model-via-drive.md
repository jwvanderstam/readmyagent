# ADR-0001: Integrate with agents through Google Drive, pull model

- Status: Accepted
- Date: 2026-11-17

## Context

Scheduled Claude agents run in Anthropic's cloud. Their shell has an outbound network allowlist (package registries, GitHub); arbitrary HTTPS endpoints are usually refused. WebFetch is read-only. The agents already have a working Google Drive connector and already write one Markdown file per run into the folder `Claude-agents`.

## Options

1. **Push to an API on the app.** Agents POST run data to readmyagent. Simple app side, but depends on network access agents most likely do not have.
2. **App as an MCP connector.** readmyagent exposes MCP tools (`write_run`, `get_feedback`) and is attached to the scheduled tasks as a custom connector. Clean, typed interface. Requires OAuth on our own endpoint and widens the attack surface.
3. **Pull from Drive.** Agents keep writing to Drive. The app reads Drive. Feedback goes back through a file in the same folder.

## Decision

Option 3. Drive is the exchange medium and the archive; the app pulls.

## Consequences

- No change to how agents reach the outside world; works today.
- Drive remains a complete, human-readable archive independent of the app.
- Latency: new runs appear at the next sync, not instantly. Acceptable for daily agents.
- Option 2 stays open as a later addition for agents that need interactive access. It would not replace Drive as the archive.
