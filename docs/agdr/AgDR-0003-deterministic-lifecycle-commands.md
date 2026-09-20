# Deterministic ORBIT lifecycle commands

> In the context of making ORBIT usable before harness integration, facing different agent runtimes and repository workflows, I decided that the lifecycle CLI will create records from explicit inputs and local repository evidence, accepting that it will not infer intent or make external tracker changes.

## Context

- ORBIT must work with Claude Code, Codex, Cursor, CI, and non-agent workflows.
- Harnesses differ in how they collect intent and present repository state.
- Inference or external side effects in the core CLI would make results difficult to reproduce and audit.

## Options Considered

| Option | Pros | Cons |
|---|---|---|
| Let each harness generate records independently | Native user experience in each harness | Divergent record semantics and difficult conformance testing |
| Make the CLI infer intent and call external providers | Fewer inputs for users | Hidden decisions, provider coupling, and non-deterministic output |
| Create records from explicit inputs and local evidence | Reproducible output, portable adapters, and clear provenance | Adapters must collect and supply the inputs |

## Decision

Chosen: **explicit-input, deterministic lifecycle commands**, because ORBIT should define durable records without choosing a model, tracker, or execution provider.

The CLI may inspect the local repository for a Project Snapshot. It must not create external issues, change code, or infer acceptance decisions. Adapters can provide those inputs and apply their own governance around the records.

## Consequences

- Generated records are reproducible from their arguments and repository state.
- Harness adapters remain responsible for interaction and workflow integration.
- Reconciliation defaults to `not-verified` until explicit evidence is supplied.
- Provider-specific execution remains outside the ORBIT core.
