# ORBIT

ORBIT is a portable planning and reconciliation standard for durable software intent, current project reality, and the next bounded execution change.

ORBIT is part of [Agent SDLC](https://agentsdlc.ai). Visit the project website at [orbitspec.dev](https://orbitspec.dev).

This repository is the source for the standard, its schemas, examples, validators, and skills. The website is published separately so the standard can be used without a website or a specific coding harness.

## Current status

ORBIT v0.1 is under development. The repository begins with the four record schemas and examples that currently live in the website repository. The initial Plan, Project Snapshot, Reconciliation, and Execution Slice are under [`orbit/`](orbit/).

## Records

- **Plan** — durable intent, outcomes, acceptance criteria, constraints, and planning knowledge.
- **ProjectSnapshot** — point-in-time project and repository state.
- **Reconciliation** — assessment of a Plan against observed evidence.
- **ExecutionSlice** — the next bounded change justified by a Reconciliation.

## Validate

```sh
npm install
npm test
```

The validator checks every example and every record under `orbit/` against its JSON Schema and verifies the cross-record references in the complete fixture set.

The portable CLI exposes the same operations to any harness:

```sh
npx orbit validate --all
npx orbit validate --all --root docs/orbit
npx orbit plan examples/plan-minimal.json
npx orbit snapshot examples/project-snapshot-minimal.json
npx orbit reconcile examples/reconciliation-minimal.json
npx orbit slice examples/slice-minimal.json
```

`orbit validate --all` validates the package fixture set (`examples/` and `orbit/`).

`orbit validate --all --root <directory>` validates only the record directories under that root (`plans/`, `snapshots/`, `reconciliations/`, `slices/`). It does not read the package fixtures. Harness adapters that store project records outside this repository must pass `--root`.

Harness adapters should call these commands and preserve their exit status. They must not replace ORBIT validation with harness-specific rules.

The lifecycle commands also create records from explicit inputs:

```sh
npx orbit snapshot --project my-project --repository app --path . --output snapshot.json
npx orbit snapshot --project my-project \
  --repository web --path ../web \
  --repository api --path ../api \
  --output project-snapshot.json
npx orbit reconcile --plan plan.json --snapshot snapshot.json --output reconciliation.json
npx orbit slice --plan plan.json --reconciliation reconciliation.json \
  --outcome outcome-id --objective "Bounded change" --why "Evidence supports this change" \
  --output slice.json
```

Before a provider write, validate and preview the complete record chain:

```sh
npx orbit sync github \
  --plan examples/plan-sso.json \
  --snapshot examples/project-snapshot-2026-09-14.json \
  --reconciliation examples/reconciliation-001.json \
  --slice examples/slice-001.json \
  --repo owner/repository \
  --dry-run
```

The GitHub adapter rejects inconsistent projects, Plan revisions, outcomes, acceptance criteria, incomplete Reconciliation assessments, and repository provenance before it calls GitHub. Remove `--dry-run` only after you review the proposed issue. The CLI does not infer intent. Harnesses provide explicit inputs and apply their own workflow rules.

## Scope

ORBIT does not require a specific agent, issue tracker, branch strategy, repository layout, storage system, or execution provider.

## Licensing

Specification and documentation are licensed under [CC BY 4.0](LICENSE). Code, scripts, and skills are licensed under [MIT](LICENSE-CODE).

## Contributors

<a href="https://github.com/me2resh" title="me2resh"><img src="https://github.com/me2resh.png?size=100" width="64" height="64" alt="me2resh"></a>
