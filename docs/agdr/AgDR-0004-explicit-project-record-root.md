# Explicit project record root for validation

> In the context of harness adapters that store ORBIT records under a managed project path, facing package-fixture `validate --all` that cannot see those records, I decided to add `--root <directory>` so validation targets one project record root without changing the package fixture path.

## Context

- Adapters such as ApexYard store Plans, Snapshots, Reconciliations, and Execution Slices under a project-local directory (for example `docs/orbit/`).
- Package `orbit validate --all` validates `examples/` and `orbit/` inside the installed ORBIT repository.
- Using package validation as a stand-in for project validation can report success while project records remain unchecked.

## Options Considered

| Option | Pros | Cons |
|---|---|---|
| Keep package-only `validate --all` | No CLI change | Adapters cannot validate project record sets |
| Replace package validation with cwd discovery | Fewer flags | Ambiguous roots and silent package vs project mix |
| Add explicit `--root <directory>` | Clear target, package path unchanged, adapter-friendly | Adapters must pass the root |

## Decision

Chosen: **explicit `--root`**, because project validation must name the record root and must not read package fixtures when that root is set.

`orbit validate --all` keeps the existing package fixture behaviour. `orbit validate --all --root <directory>` validates only `plans/`, `snapshots/`, `reconciliations/`, and `slices/` under the supplied root.

## Consequences

- Harness adapters must pass `--root` for managed-project validation.
- Cross-record checks still run on the selected record set.
- Missing subdirectories under the root are treated as empty rather than fatal.
- Package fixture validation remains available for ORBIT repository CI.

## Ticket

Closes #7
