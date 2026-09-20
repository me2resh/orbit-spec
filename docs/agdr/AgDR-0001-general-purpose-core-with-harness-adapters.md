# General-purpose ORBIT core with harness adapters

> In the context of extracting ORBIT into a standalone repository, facing multiple coding harnesses with different invocation models, I decided to keep ORBIT general-purpose and provide thin harness adapters to achieve portability without coupling the standard to ApexYard, accepting that each adapter needs its own maintenance and conformance tests.

## Context

- ORBIT defines portable records for plans, project snapshots, reconciliations, and execution slices.
- Claude Code, Codex, Cursor, and GitHub Copilot expose different skill, command, and automation mechanisms.
- ApexYard already provides a governed planning and delivery workflow, but ORBIT must also be usable outside ApexYard.
- The website and standard repository must not become dependent on one coding harness.

## Options Considered

| Option | Pros | Cons |
|---|---|---|
| Make ORBIT an ApexYard-only model | Fastest integration and one workflow | Prevents use with other harnesses and couples the standard to one product |
| Put all harness-specific behaviour in the ORBIT core | One repository contains everything | Core records become coupled to unstable tool interfaces and are difficult to validate portably |
| Keep a general-purpose core with thin harness adapters | Portable records, shared validation, and native integrations per harness | Requires adapter documentation, packaging, and conformance tests |

## Decision

Chosen: **general-purpose ORBIT core with thin harness adapters**, because the standard should define records, invariants, lifecycle, and validation independently of any agent or workflow product.

ORBIT commands should describe standard operations such as `orbit plan`, `orbit snapshot`, `orbit reconcile`, `orbit slice`, and `orbit validate`. Harness adapters may expose those operations as skills, slash commands, rules, or CLI wrappers. ApexYard may orchestrate the full governed lifecycle, but it must consume ORBIT rather than define it.

## Consequences

- The ORBIT repository owns schemas, invariants, the CLI, examples, and adapter conformance requirements.
- Harness adapters remain thin and translate local invocation into ORBIT operations.
- ApexYard can provide a first-class adapter with ticket, review, QA, and deployment gates.
- Adapters must not change the meaning of ORBIT records.
- Each adapter needs contract tests against the same fixtures and validation command.

## Artifacts

- [ORBIT repository](https://github.com/me2resh/orbit-spec)
- [Initial baseline PR](https://github.com/me2resh/orbit-spec/pull/2)
