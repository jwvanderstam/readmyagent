# ADR-0007: One self-hosted instance per user

- Status: Accepted
- Date: 2026-11-17

## Context

The owner wants other people to be able to use readmyagent. Each user has their own scheduled agents, their own Drive folder and their own mail metadata.

Facts and constraints:

- The data is personal: mail metadata and security findings (see [SECURITY.md](../../SECURITY.md)).
- A shared app that reads files in other people's Drive needs a restricted Drive scope. For a public app, Google requires verification including a security assessment for restricted scopes. An unverified app in testing mode gets refresh tokens that expire after 7 days, which breaks the daily cron (see ADR-0006).
- Vercel Hobby and Neon Free are free for personal, non-commercial use (ADR-0002). Each user can run an instance at zero cost on their own accounts.
- The repository is public since 2026-11-17.

## Options

1. **Multi-tenant service** run by the owner. One deployment, a users table, per-user Drive access. Simplest for users. The owner becomes controller of everyone's personal data, needs Google verification for a restricted scope, and one breach exposes all users.
2. **One instance per user (self-hosted).** Each user forks the repository and deploys it to their own Vercel, Neon and Google Cloud accounts. No shared data, no shared secrets. Setup takes more steps per user.
3. Desktop or local-only app. No hosting, but no access from a phone and no daily cron.

## Decision

Option 2. readmyagent is a self-hosted, single-owner application. Every instance belongs to exactly one person, who owns all accounts and secrets involved. The project is released under the MIT license.

To make this work:

- **Nothing personal in code.** The owner's identity, timezone and Drive IDs are environment variables. Agents are data managed in the app, not a config file in the repository. The author's own agents appear in documentation only as examples.
- **Guided setup.** A "Deploy to Vercel" button that asks for the required environment variables and adds Neon, a `gcloud` setup script for the Google Cloud side, and a setup page in the app that reports per setting whether it is configured, without ever showing a value.
- **Fail closed.** Environment variables are validated at startup. If a required value such as `OWNER_EMAIL` is missing or invalid, every route serves only the setup page, which shows no data and offers no sign-in, rather than run with weaker access control.
- **Updates are pulled, not pushed.** Releases are tagged and listed in `CHANGELOG.md`. Users update their fork by merging a release tag. Instances do not deploy automatically from the upstream `main`.

## Consequences

- The owner never holds other users' data or credentials.
- No Google app verification is needed: every user creates their own Google Cloud project and OAuth client, used only by themselves.
- Setup is the main hurdle. The setup script, setup page and operations guide are part of phase 1 scope, not an afterthought.
- A compromised upstream repository could reach every instance whose owner merges a release. Mitigations in SECURITY.md: protected `main`, pinned CI actions, dependency review, tagged releases and manual merges by each user.
- ADR-0003 stays valid per instance: one allowlisted owner per deployment.
- `config/agents.ts` is replaced by an agents table maintained in the app (see [data model](../data-model.md)).
