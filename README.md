# readmyagent

A self-hosted, personal reader for the output of scheduled Claude agents. It collects every agent run in one place, keeps the history, lets the owner give feedback on individual findings, tracks follow-up actions, and feeds that feedback back to the agents on their next run.

```
Claude agent runs  ->  writes run files to Google Drive  ->  readmyagent ingests them
        ^                                                          |
        |                                                          v
   reads feedback.json  <-  readmyagent publishes feedback  <-  owner reviews, gives feedback, tracks actions
```

Example: the agents of the author's own instance.

| Agent | Schedule (Europe/Amsterdam) | Purpose |
|---|---|---|
| Mail-triage | daily 06:48 | Labels and triages a Gmail inbox |
| LocalChat-wachter | daily 07:44 | Read-only watcher over the LocalChat repository |
| Weekbrief | Friday 12:50 | Weekly summary and agent health check |

The design is agent-agnostic: any agent that follows the [agent contract](docs/agent-contract.md) can be added in the app, without code changes.

## Run your own instance

readmyagent is not a hosted service. Everyone who wants to use it deploys their own instance, on their own GitHub, Vercel, Neon and Google Cloud accounts, within the free plans. No data or secrets are shared with anyone, including the maintainers. See [ADR-0007](docs/adr/0007-self-hosted-instance-per-user.md) and the setup guide in [operations](docs/operations.md).

## Status

Phase 1 in progress: application scaffold and CI are in place, features follow. See [roadmap](docs/roadmap.md).

## Documentation

| Document | Content |
|---|---|
| [Architecture](docs/architecture.md) | Context, building blocks, data flows, deployment, quality goals, risks |
| [Agent contract](docs/agent-contract.md) | File formats agents write and read (run JSON, feedback.json) |
| [Data model](docs/data-model.md) | Database schema and state machines |
| [Operations](docs/operations.md) | Setup, configuration, runbook |
| [Architecture decisions](docs/adr/README.md) | ADR log |
| [Standards](docs/standards.md) | Coding, API, data, logging and documentation standards |
| [Contributing](CONTRIBUTING.md) | Branching, commits, reviews, definition of done |
| [Security](SECURITY.md) | Threat model and security controls |
| [Roadmap](docs/roadmap.md) | Phases and scope |
| [Changelog](CHANGELOG.md) | Notable changes |

## Stack (decided, see ADRs)

- Next.js (App Router) with TypeScript in strict mode, hosted on Vercel Hobby
- Neon Postgres via the Vercel Marketplace, accessed with Drizzle ORM
- Auth.js with Google sign-in, restricted to a single allowlisted account
- Google Drive API as the integration point with the agents, accessed as a service account through Workload Identity Federation, without a key

## License

[MIT](LICENSE).
