# Architecture decision records

Format: [Michael Nygard](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions), see [template](0000-template.md). One decision per file, numbered, never deleted. A changed decision gets a new ADR that supersedes the old one.

| ADR | Title | Status |
|---|---|---|
| [0001](0001-pull-model-via-drive.md) | Integrate with agents through Google Drive, pull model | Accepted |
| [0002](0002-nextjs-vercel-neon.md) | Next.js on Vercel Hobby with Neon Postgres | Accepted |
| [0003](0003-single-owner-google-auth.md) | Single-owner authentication with Google sign-in | Accepted |
| [0004](0004-json-run-contract.md) | Structured JSON run file next to the Markdown log | Accepted |
| [0005](0005-feedback-file-loop.md) | Feedback to agents through an application-owned feedback.json | Accepted |
| [0006](0006-drive-service-account.md) | Drive access with a service account, updates only | Superseded by 0008 |
| [0007](0007-self-hosted-instance-per-user.md) | One self-hosted instance per user | Accepted |
| [0008](0008-drive-access-workload-identity-federation.md) | Drive access through Workload Identity Federation, no service account key | Accepted |
| [0009](0009-agents-register-from-run-files.md) | Agents register and update themselves from their run files | Accepted |
| [0010](0010-standing-feedback-stays-published.md) | Standing feedback stays in feedback.json until withdrawn | Accepted |
| [0011](0011-workspace-api-tiering-and-ai-tools-addendum.md) | Position under the Workspace API tiering model and AI Tools Addendum | Accepted |
| [0012](0012-markdown-fallback-ingest.md) | Markdown fallback ingest for agents without a JSON run file | Accepted |
