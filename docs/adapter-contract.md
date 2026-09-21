# ORBIT adapter contract

An adapter connects a coding harness to the ORBIT CLI. The adapter owns invocation and access to the repository. The CLI owns record validation.

## Required operations

An adapter MUST expose these ORBIT operations:

| Operation | CLI command | Input |
|---|---|---|
| Validate package fixtures | `orbit validate --all` | ORBIT repository checkout |
| Validate a project record root | `orbit validate --all --root <directory>` | Directory with `plans/`, `snapshots/`, `reconciliations/`, and `slices/` |
| Validate a Plan | `orbit plan <file>` | Plan JSON file |
| Validate a Project Snapshot | `orbit snapshot <file>` | Project Snapshot JSON file |
| Validate a Reconciliation | `orbit reconcile <file>` | Reconciliation JSON file |
| Validate an Execution Slice | `orbit slice <file>` | Execution Slice JSON file |

When an adapter stores ORBIT records for a managed project, it MUST pass `--root <project-record-root>`. The adapter MUST NOT rely on package fixture validation to stand in for project validation.

The adapter MUST return the CLI exit status. A non-zero status means that the record or repository is not conforming.

## Project Snapshot capture

An adapter MAY capture one project state with the lifecycle command:

```sh
orbit snapshot --project <id> \
  --repository <id> --path <local-path> \
  --repository <id> --path <local-path> \
  --output <file>
```

The adapter MUST provide one stable identifier and one local path for each repository.
The command records each repository branch and commit in one Project Snapshot.
The command rejects duplicate identifiers before repository inspection.
An inspection failure prevents the command from writing the output file.

## Harness independence

An adapter MAY expose these operations as a skill, command, task, rule, or CI step. It MUST NOT change the ORBIT record shape or weaken schema validation.

## Contract fixtures

The repository test suite runs every required operation against shared fixtures in `examples/`. Adapter implementations should run the same fixtures through their integration surface.
