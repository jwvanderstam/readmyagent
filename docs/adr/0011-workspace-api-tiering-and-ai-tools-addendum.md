# ADR-0011: Position under the Workspace API tiering model and AI Tools Addendum

- Status: Accepted
- Date: 2026-11-28
- Review by: 2027-02-01 (start of MCP enforcement), or earlier when the open checks below are done

## Context

On 2026-11-24 Google Cloud sent the owner a mandatory service announcement, "[Pricing Update] Changes to Google Workspace API usage limits starting Feb 2027 and new AI policies", listing `readmyagent` as an affected project. It came twice: once to the owner as billing administrator, once as project owner. It is the same project and the same action.

Facts from the announcement (source: the email of 2026-11-24):

- From 2026-11-24 the Workspace APIs, including MCP servers and CLI, have two usage tiers, starting with Gmail, Drive and Calendar. **Standard tier**: no cost, published quotas. **Scaled tier**: higher quotas, billed above a daily free allowance from 2027-04-01.
- **MCP requirement**: "AI agents or similar access tools" must reach Workspace data through MCP, not through the Workspace REST APIs. Technical enforcement starts 2027-02-01.
- New quota increase requests require the Scaled tier from 2026-11-24.
- Projects that take no action fall back to Standard tier limits on 2027-04-01, at no cost.
- The new **Workspace AI Tools Addendum** prohibits AI agents and other access tools from certain risky activities, including "storing certain data derived from use of Workspace APIs for extended periods of time" and scraping Workspace APIs. It also adds a disclaimer for harm caused by third-party AI tools.

Facts from the Drive API usage limits page (developers.google.com/drive/api/v3/limits, checked 2026-11-28): projects that are not enrolled fall back to Standard tier limits on 2027-04-01 and excess requests are throttled. A "Standard Tier with internal-use exception" allows higher REST quotas without the Scaled tier. MCP server quotas are not eligible for that exception.

Facts from this repository:

- The app calls the Drive REST API v3 directly (`lib/drive/client.ts`): list files in the agent folder, download run files, update `feedback.json`. It does not use the full `googleapis` package (architecture, Drive client).
- Credentials: a service account impersonated through Workload Identity Federation, scope `https://www.googleapis.com/auth/drive`, effectively limited to the one shared folder (ADR-0006, ADR-0008). Sign-in uses only `openid email profile` (ADR-0003).
- Sync triggers: daily cron, manual sync, and sync on open when the last sync is older than five minutes. Volume is on the order of tens to low hundreds of requests per day.
- The app contains no language model. It does not reason, decide or act on Workspace data. It parses run files against a fixed schema (ADR-0004), stores them, and publishes owner-written feedback (ADR-0005).
- Runs and items are stored in Neon Postgres and kept indefinitely (data model, section 4). Run files contain summaries of the owner's mail and Gmail thread IDs, which the agents wrote using their own connectors.
- The scheduled Claude agents reach Gmail and Drive through Anthropic's connectors, which are MCP servers in Anthropic's Google Cloud projects, not in this project.

Open: the text of the Addendum was not available when this ADR was written. Its definition of "AI agent or similar access tool" and the exact scope of the retention prohibition are unknown. The conclusions below that depend on them are marked as assumptions.

## Options

1. **Treat readmyagent as a conventional application.** Stay on the Drive REST API and the Standard tier. Keep the run history. Pro: no change, no cost, the architecture already sends agent access through MCP (agents use the Drive connector, ADR-0001). Con: rests on an assumption about the Addendum's definition.
2. **Treat readmyagent as an AI access tool now.** Move Drive access to the Drive MCP server before 2027-02-01 and limit how long run data is kept. Pro: safe under the strictest reading. Con: work and a retention limit that may not be required, and MCP quotas cannot use the internal-use exception.
3. **Select the Scaled tier.** Removes quota risk. Con: solves a problem the app does not have. Usage is far below any plausible Standard quota, and it introduces billing on the owner's account.

## Decision

Option 1, with three conditions.

1. **Classification (assumption).** readmyagent is not an AI agent or similar access tool in the sense of the Addendum, because it contains no model and only exchanges files in a fixed schema with one folder. The AI component in the loop, the agents, already uses MCP.
2. **Tier.** Stay on the Standard tier. Do not enroll in the Scaled tier and do not enable billing for Workspace API usage. If more REST quota is ever needed, use the internal-use exception before considering Scaled.
3. **Design boundary.** As soon as readmyagent itself sends Workspace-derived data to a language model (for example in-app summaries, classification or AI-assisted feedback), it becomes an AI access tool. Such a feature requires a new ADR that moves Drive access to MCP and sets a retention limit for Workspace-derived data, before the feature is built.

## Consequences

- No code change and no cost now. The fallback on 2027-04-01 changes nothing for this app.
- Owner checks, to be done before 2027-02-01:
  - Workspace API usage dashboard in the Google Cloud console: confirm `readmyagent` stays under the Standard tier limits.
  - Workspace AI Tools Addendum: confirm the definition of "AI agent or similar access tool" and the retention prohibition. If the app falls inside the definition, or the retention clause also covers conventional apps, this ADR is superseded by one that chooses option 2.
- The indefinite retention in the data model (section 4) depends on this ADR. It stays as it is until the Addendum check is done.
- Every self-hosted instance (ADR-0007) runs in its own Google Cloud project and is in the same position. Each owner receives the same announcement and does the same checks.
- Phase 3 candidate "App as MCP connector" (ADR-0001 option 2) is unaffected. It concerns agents calling readmyagent, not readmyagent calling Workspace.
- Risk R11 is added to the architecture risk table.
