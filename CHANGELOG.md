# Changelog

All notable changes to this project are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: [SemVer](https://semver.org/).

## [Unreleased]

### Added

- Next.js 16 application scaffold with TypeScript strict mode, Tailwind CSS, ESLint, Prettier and Vitest.
- CI workflow `ci`: format, lint, typecheck, tests, dependency audit and build.
- Contract tests that validate all examples in `schemas/examples` and `docs/agent-contract.md` against the JSON Schemas.
- Dependabot version updates for npm and GitHub Actions.
- Database schema and initial migration for agents, runs, items, feedback, actions, sync runs and ingest errors. The sync lock is enforced by a partial unique index.
- CI check that fails when the schema changes without a committed migration.
- Ingestion of run files: validation against the contract, idempotent storage per Drive file, item deduplication by fingerprint, ingest errors for invalid files, and feedback consumption from `feedback_consumed`.
- Zod versions of the contract schemas, with tests that keep them in agreement with the JSON Schemas.
- Coverage thresholds in CI for the core domain modules.
- Feedback: create with validation per type, withdraw, and publish all open feedback as a contract-valid `feedback.json`.
- Health calculation: expected runs from each agent's schedule (timezone and DST aware), missing and failed runs, unscheduled runs, and feedback that stays unconsumed across two expected runs.
- Architecture document, ADR-0001 to ADR-0006.
- Agent contract 1.0 with JSON Schemas for run files and `feedback.json`.
- Data model, standards, contributing guide, security model, operations runbook, roadmap.
- ADR-0007: one self-hosted instance per user. ADR-0008: Drive access through Workload Identity Federation, superseding ADR-0006.
- MIT license.

### Changed

- Operations guide rewritten for owners of their own instance: Workload Identity Federation instead of a service account key, preview isolation, updating by release tag.
- Security model extended with secret handling rules, preview isolation and supply chain threats.
- Agents are managed in the app instead of `config/agents.ts`.
