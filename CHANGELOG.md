# Changelog

All notable changes to this project are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: [SemVer](https://semver.org/).

## [Unreleased]

### Added

- Next.js 16 application scaffold with TypeScript strict mode, Tailwind CSS, ESLint, Prettier and Vitest.
- CI workflow `ci`: format, lint, typecheck, tests, dependency audit and build.
- Contract tests that validate all examples in `schemas/examples` and `docs/agent-contract.md` against the JSON Schemas.
- Dependabot version updates for npm and GitHub Actions.
- Architecture document, ADR-0001 to ADR-0006.
- Agent contract 1.0 with JSON Schemas for run files and `feedback.json`.
- Data model, standards, contributing guide, security model, operations runbook, roadmap.
- ADR-0007: one self-hosted instance per user. ADR-0008: Drive access through Workload Identity Federation, superseding ADR-0006.
- MIT license.

### Changed

- Operations guide rewritten for owners of their own instance: Workload Identity Federation instead of a service account key, preview isolation, updating by release tag.
- Security model extended with secret handling rules, preview isolation and supply chain threats.
- Agents are managed in the app instead of `config/agents.ts`.
