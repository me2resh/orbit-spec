# ORBIT adapter contract

An adapter connects a coding harness to the ORBIT CLI. The adapter owns invocation and access to the repository. The CLI owns record validation.

## Required operations

An adapter MUST expose these ORBIT operations:

| Operation | CLI command | Input |
|---|---|---|
| Validate all records | `orbit validate --all` | Repository checkout |
| Validate a Plan | `orbit plan <file>` | Plan JSON file |
| Validate a Project Snapshot | `orbit snapshot <file>` | Project Snapshot JSON file |
| Validate a Reconciliation | `orbit reconcile <file>` | Reconciliation JSON file |
| Validate an Execution Slice | `orbit slice <file>` | Execution Slice JSON file |

The adapter MUST return the CLI exit status. A non-zero status means that the record or repository is not conforming.

## Harness independence

An adapter MAY expose these operations as a skill, command, task, rule, or CI step. It MUST NOT change the ORBIT record shape or weaken schema validation.

## Contract fixtures

The repository test suite runs every required operation against shared fixtures in `examples/`. Adapter implementations should run the same fixtures through their integration surface.
