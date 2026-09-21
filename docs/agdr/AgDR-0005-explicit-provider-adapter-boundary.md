# Explicit provider adapters behind the sync boundary

> ORBIT needs provider execution without coupling portable records to provider APIs. I chose explicit sync adapters and accepted additional boundary tests.

## Context

- AgDR-0003 keeps Plan, Snapshot, Reconciliation, and Slice creation deterministic.
- Execution Slices must reach issue trackers after an operator reviews their provenance.
- Provider behavior must not change canonical ORBIT resources or their meaning.
- A provider failure must not corrupt the deterministic record chain.

## Options Considered

| Option | Pros | Cons |
| --- | --- | --- |
| Keep provider execution outside this repository | Preserves strict package isolation | Splits the reference workflow and duplicates validation rules |
| Add provider writes to lifecycle commands | Provides one short workflow | Couples record creation to network side effects |
| Add explicit provider adapters behind `orbit sync` | Keeps lifecycle commands deterministic and provides one audited boundary | Expands the package and requires provider-specific tests |

## Decision

Chosen: **explicit provider adapters behind `orbit sync`**, because operators need a reference execution path without changing canonical resource behavior.

The record schemas, validator, and lifecycle builders remain provider-independent.
Provider modules can consume a validated record chain through an explicit sync command.
They cannot infer intent or criterion achievement.

The command must validate the complete record chain before authentication or provider calls.
A dry run must perform no authentication or provider calls.
A write requires an explicit provider target and all required provider configuration.
Provider identities, recovery state, and action history must remain outside canonical ORBIT resources.

This decision refines AgDR-0003.
Lifecycle commands still cannot write to external systems.

## Consequences

- The package can ship audited reference adapters without adding provider fields to ORBIT schemas.
- Each adapter needs zero-call failure tests for validation and configuration errors.
- Each adapter needs preview, idempotency, recovery, and read-back behavior before production use.
- A later package split can move adapters without changing the core resource contract.

## Artifacts

- [Issue #9](https://github.com/me2resh/orbit-spec/issues/9)
- [Pull request #10](https://github.com/me2resh/orbit-spec/pull/10)
- [AgDR-0003](AgDR-0003-deterministic-lifecycle-commands.md)
