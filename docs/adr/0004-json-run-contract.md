# ADR-0004: Structured JSON run file next to the Markdown log

- Status: Accepted
- Date: 2026-11-17

## Context

Agents currently write free-form Markdown. Extracting runs, items and metrics from Markdown with heuristics or an LLM is fragile and makes the reader's correctness depend on wording.

## Options

1. Parse Markdown with heuristics.
2. Parse Markdown with an LLM call during ingestion.
3. Agents write a JSON file that follows a versioned schema, next to the Markdown log.

## Decision

Option 3. The JSON file is the contract, defined in `/schemas` and explained in [agent-contract.md](../agent-contract.md). The Markdown log stays for human reading and is linked from the reader.

## Consequences

- Ingestion is deterministic and testable.
- Agent prompts must be extended with the schema and a self-check. Invalid files are recorded as ingest errors and shown, not dropped.
- Two files per run in Drive. Acceptable.
- Schema evolution needs discipline: see versioning in the contract.
