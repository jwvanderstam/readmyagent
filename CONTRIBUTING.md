# Contributing

Maintained by a single owner and developed with the help of Claude. Every user runs their own instance (ADR-0007); contributions that keep the app self-hostable are welcome. These rules keep the history readable and `main` always deployable.

## Branching

- `main` is production. It is protected: no direct pushes, pull request required, CI must pass.
- Work happens on short-lived branches: `feat/<topic>`, `fix/<topic>`, `docs/<topic>`, `chore/<topic>`.
- Rebase on `main` before merging. Squash merge.

## Commits

[Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <summary in imperative mood, max 72 chars>

<body: why, not what>
```

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`, `perf`, `security`.
Scopes: `ingest`, `feedback`, `health`, `ui`, `auth`, `db`, `drive`, `contract`, `infra`.

## Pull requests

- One logical change per PR.
- Fill in the PR template, including how it was tested and which documents changed.
- A change to `/schemas` is a contract change: bump the contract version according to the versioning rules and update the agent prompts that depend on it.
- A change to the database schema includes the generated migration.

## Definition of done

- [ ] Code follows [standards](docs/standards.md); lint, typecheck and tests pass in CI
- [ ] Tests added or updated for changed behavior
- [ ] Documentation updated in the same PR (architecture, contract, data model, operations, ADR where relevant)
- [ ] `CHANGELOG.md` updated under `Unreleased` for user-visible changes
- [ ] No secrets, no real personal data in code, fixtures or logs
- [ ] Preview deployment checked on a phone-sized viewport

## Local development

See [operations](docs/operations.md#local-development).
