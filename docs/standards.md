# Standards

These standards apply to all code and documentation in this repository. A pull request that breaks one needs an explicit reason in its description.

## 1. Language and tooling

| Area | Standard |
|---|---|
| Language | TypeScript, `strict: true`, `noUncheckedIndexedAccess: true`. No `any` without a comment explaining why. |
| Runtime | Node.js LTS as supported by Vercel. Version pinned in `package.json` `engines` and `.nvmrc`. |
| Package manager | pnpm, lockfile committed. |
| Framework | Next.js App Router. Server Components by default; `"use client"` only where interaction requires it. |
| Formatting | Prettier, default config plus `printWidth: 100`. Enforced in CI. |
| Linting | ESLint with `next/core-web-vitals` and `@typescript-eslint/recommended-type-checked`. Zero warnings in CI. |
| Styling | Tailwind CSS. Small presentational components live in `components/`; shadcn/ui is added per component when one needs behaviour that is hard to get right (dialogs, menus). No inline style objects except for dynamic values. |
| Validation | Zod for every external input. Types are inferred from schemas, not duplicated. |
| Database | Drizzle ORM and drizzle-kit migrations. No raw SQL string building; parameterized queries only. |
| Dependencies | Add only with a reason in the PR. Prefer platform and framework features. Renovate or Dependabot weekly. |

## 2. Code structure

- Domain logic lives in `lib/`, framework glue in `app/`. `lib/` must not import from `app/`.
- One module per responsibility (see building blocks in [architecture](architecture.md)). Modules expose a small typed API through `index.ts`.
- Pure functions for parsing, validation, health calculation and feedback serialization, so they can be unit tested without I/O.
- Side effects (Drive, database, time) are injected or isolated behind thin adapters. `now()` is injectable for tests.
- No business logic in React components beyond presentation.

## 3. Naming

| Item | Convention | Example |
|---|---|---|
| Files | kebab-case | `feedback-publisher.ts` |
| Types, components | PascalCase | `RunSummary` |
| Functions, variables | camelCase | `publishFeedback` |
| Constants | UPPER_SNAKE_CASE | `SYNC_LOCK_TTL_MS` |
| Database tables and columns | snake_case, plural tables | `ingest_errors.drive_file_id` |
| Agent slugs, item kinds | kebab-case slugs, snake_case kinds | `mail-triage`, `proposal_delete` |
| Environment variables | UPPER_SNAKE_CASE, grouped by prefix | `GCP_PROJECT_NUMBER`, `DRIVE_FOLDER_ID` |

## 4. API and route handlers

- Route handlers validate input with Zod and return typed JSON: `{ data }` on success, `{ error: { code, message } }` on failure.
- HTTP status codes carry meaning: 400 invalid input, 401 no session, 403 wrong account, 404, 409 conflict (sync lock, version mismatch), 500 unexpected.
- Mutations from the UI use Server Actions with the same validation and authorization checks as route handlers.
- Every handler checks authorization itself, even behind middleware.
- The cron endpoint accepts only requests carrying `Authorization: Bearer ${CRON_SECRET}`.

## 5. Data

- All timestamps `timestamptz`, stored in UTC, displayed in Europe/Amsterdam.
- Every schema change is a migration in the same PR as the code that needs it. Migrations are forward-only; a rollback is a new migration.
- Ingestion is idempotent and transactional per run file.
- Never delete owner-owned data (feedback, actions, item states) in code paths other than an explicit owner action.

## 6. Error handling and logging

- Fail loudly at boundaries. A Drive file that fails validation produces an `ingest_errors` row, a log line, and a visible marker in the UI.
- Do not swallow errors. `catch` blocks either handle the error meaningfully or rethrow with context.
- Logs are structured JSON with `level`, `event`, `msg` and context fields. One event name per log site, for example `ingest.file_invalid`.
- Never log secrets, tokens, full file contents or mail bodies. Log IDs instead.

## 7. Testing

| Level | Tool | Scope | Minimum |
|---|---|---|---|
| Unit | Vitest | `lib/` pure functions: contract parsing, health, feedback serialization, reconciliation | 90% line coverage in `lib/ingest`, `lib/feedback`, `lib/health` |
| Integration | Vitest + PGlite (in-process Postgres, real migrations) | Ingestion end to end with recorded Drive fixtures | Every ingestion scenario in architecture section 6 |
| End to end | Playwright | Sign-in guard, inbox, give feedback, create action | Happy path plus unauthorized access |
| Contract | Vitest | Example files in `docs/agent-contract.md` and `schemas/examples/` validate against the schemas | All examples |

Fixtures use invented data only. No real mail metadata in the repository.

## 8. Security

See [SECURITY.md](../SECURITY.md). Minimum rules for every change:

- No secret in code, tests, fixtures or logs.
- No secret in a `NEXT_PUBLIC_` variable. Modules that read secrets import `server-only`. Environment variables are read through the validated config module only.
- No instance-specific value (names, email addresses, IDs) in code. It belongs in configuration or the database.
- GitHub Actions are pinned to a commit SHA and declare minimal `permissions`.
- Agent-produced text is rendered with the shared `SafeMarkdown` component only.
- New dependencies are checked with `pnpm audit` in CI.
- CodeQL scans every pull request. New alerts are fixed or dismissed with a reason before merge.

## 9. Documentation

- Language: English for all repository documentation and code comments.
- Every architectural choice with lasting effect gets an ADR before or with the implementing PR.
- When behavior changes, the relevant document changes in the same PR: architecture, contract, data model or operations.
- Markdown style: ATX headings, one sentence per idea, tables for structured comparisons, no em dashes.
- Code comments explain why, not what.
- `CHANGELOG.md` follows Keep a Changelog; every user-visible change gets an entry under `Unreleased`.

## 10. Accessibility and UI

- Usable on a phone first: the reader is mostly checked on mobile.
- Semantic HTML, keyboard navigable, visible focus, color contrast WCAG AA.
- Severity is never shown by color alone; always also by label.
