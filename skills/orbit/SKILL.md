---
name: orbit
description: Use when creating or updating ORBIT plans, snapshots, reconciliations, execution slices, progress reports, or a GitHub slice issue in any repository.
---

# ORBIT

Run the `orbit` CLI for one project. This skill works in any git repository. Store that project's records under `orbit/` at the project root. Do not look for records anywhere else.

## 1. Check that `orbit` is installed

Run this first, before any other step:

```sh
command -v orbit
```

If that prints nothing or exits non-zero, `orbit` is not on `PATH`. Tell the user to install it, then stop. Do not write records, do not call `npx`, and do not continue the lifecycle.

Until the npm package is published:

```sh
npm install -g github:me2resh/orbit-spec#v0.1.0
```

Or, once `orbit-spec` is published:

```sh
npm install -g orbit-spec
```

## 2. Where records live

Create these directories under the project root when they do not already exist:

- `orbit/plans/`
- `orbit/snapshots/`
- `orbit/reconciliations/`
- `orbit/slices/`

Name each file so `orbit validate <file>` can infer its type from the basename:

- `plan-*.json`
- `snapshot-*.json` (or `project-snapshot-*.json`)
- `reconciliation-*.json`
- `slice-*.json`

Pass `--output` paths inside those directories. The CLI creates the parent directory when `--output` is set.

After every record is written, run:

```sh
orbit validate --all --root orbit
```

Stop if it exits non-zero. `orbit validate` and `orbit validate --all` without `--root` check the installed package fixtures, not this project's `orbit/` directory. Project checks always pass `--root orbit`.

A single file can also be checked with `orbit validate <file>`, or with `orbit plan <file>`, `orbit snapshot <file>`, `orbit reconcile <file>`, or `orbit slice <file>`. Those typed commands pass the record type explicitly. The root command is still required after each write because it checks cross-record references.

## 3. Order

Follow this order. Do not skip ahead.

1. Plan
2. Snapshot
3. Reconcile
4. Slice

Do not create a slice record before its Plan, Project Snapshot, and Reconciliation exist and `orbit validate --all --root orbit` succeeds. Do not create or update a GitHub slice issue before that slice record exists on disk and the same validation succeeds.

The CLI does not infer intent. Pass the flags below explicitly. Do not add flags that are not listed here.

## 4. Plan

`orbit plan` does not author a Plan. Write the JSON yourself, then validate or copy it.

Validate an existing file:

```sh
orbit plan <record.json>
```

Copy a validated Plan to the project record root:

```sh
orbit plan --input <file> [--output <file>]
```

`--input` is required for the copy form. `--output` is optional; without it the command prints the JSON and does not write a file.

Write `orbit/plans/plan-<id>.json` with only these fields. `specVersion` is the string `0.1`. `revision` is an integer greater than or equal to 1. `project` is an object with an `id` string. `outcomes` is an array of objects with `id` and `title` (`intent` on an outcome is optional). `acceptanceCriteria` is an array of objects with `id`, `outcomeId`, and `statement`. Do not add other properties.

Then run `orbit validate --all --root orbit`.

## 5. Snapshot

Validate an existing file:

```sh
orbit snapshot <record.json>
```

Capture the current branch and `HEAD` commit of one or more local git repositories:

```sh
orbit snapshot --project <id> --repository <id> --path <git-repo> [--repository <id> --path <git-repo> ...] [--id <id>] [--output <file>]
```

`--project` is required. Repeat `--repository` and `--path` as pairs; at least one pair is required, and the counts must match. Each `--path` is a local git repository. Duplicate repository ids are rejected and nothing is written. `--id` and `--output` are optional. When `--id` is omitted, the CLI generates an id that starts with `snapshot-<project-id>-`.

Example for this project:

```sh
orbit snapshot --project <project-id> --repository <repository-id> --path . --output orbit/snapshots/snapshot-<id>.json
```

The snapshot `project.id` must match the Plan `project.id`. Then run `orbit validate --all --root orbit`.

## 6. Reconcile

Validate an existing file:

```sh
orbit reconcile <record.json>
```

Build a Reconciliation from a Plan file and a Snapshot file:

```sh
orbit reconcile --plan <file> --snapshot <file> [--id <id>] [--output <file>]
```

`--plan` and `--snapshot` are required. `--id` and `--output` are optional. When `--id` is omitted, the CLI generates an id that starts with `reconciliation-<plan-id>-`.

The command copies `planId` and `planRevision` from the Plan and `projectSnapshotId` from the Snapshot. It writes one observation per snapshot repository. Every acceptance criterion is assessed as `not-verified` with empty `evidence` and the explanation `No explicit evidence was supplied for this criterion.` There is no flag for status or evidence. To record evidence, edit the written JSON so each assessment has `criterionId`, `status` (`not-verified`, `partially-verified`, `achieved`, or `contradicted`), and `evidence`, then validate again. Evidence that names a `repositoryId` must use that snapshot repository, and a `commit` on the evidence must equal the snapshot commit.

```sh
orbit reconcile --plan orbit/plans/plan-<id>.json --snapshot orbit/snapshots/snapshot-<id>.json --output orbit/reconciliations/reconciliation-<id>.json
```

Then run `orbit validate --all --root orbit`.

## 7. Slice

Validate an existing file:

```sh
orbit slice <record.json>
```

Build an Execution Slice only after the Plan and Reconciliation records exist:

```sh
orbit slice --plan <file> --reconciliation <file> --outcome <id> --objective <text> --why <text> [--id <id>] [--output <file>] [--contributes <id,id>] [--include <item,item>] [--exclude <item,item>]
```

Required: `--plan`, `--reconciliation`, `--outcome`, `--objective`, `--why`. Optional: `--id`, `--output`, `--contributes`, `--include`, `--exclude`. When `--id` is omitted, the CLI generates an id that starts with `slice-<plan-id>-`.

`--outcome` must be an outcome id on the Plan. `--contributes`, `--include`, and `--exclude` are comma-separated lists with no spaces. They map to `contributesTo`, `scope.include`, and `scope.exclude`. Omitted lists are empty. The command sets `basedOn.repositories` to `{}`. It does not copy snapshot commits. A non-empty `basedOn.repositories` object must use repository ids and commits from the Reconciliation's snapshot; add that object by editing the written JSON, then validate again. There is no flag for repository commits.

```sh
orbit slice --plan orbit/plans/plan-<id>.json --reconciliation orbit/reconciliations/reconciliation-<id>.json --outcome <outcome-id> --objective "<bounded change>" --why "<why this change>" --output orbit/slices/slice-<id>.json
```

Then run `orbit validate --all --root orbit`. Do not run `orbit sync github` until this succeeds.

## 8. Progress

Progress reads `plans/`, `reconciliations/`, and `slices/` under a record root. It does not read snapshots. It needs at least one Plan.

```sh
orbit progress --root <directory> [--plan <id>] [--output <file>] [--direction TD|LR]
```

`--root` is required. For this skill, `--root` is `orbit`. `--plan`, `--output`, and `--direction` are optional. `--direction` is case-sensitive: `TD` or `LR`. The default graph is `LR`. Any other direction is rejected. Without `--output`, the Markdown report goes to standard output. With `--output`, parent directories are created and the report is written to that file.

If more than one Plan id exists under the root, `--plan <id>` is required. The command uses the highest `revision` of that Plan, the latest Reconciliation for that Plan id by `reconciledAt` (ties use id order), and every Slice for that Plan id. Reconciliations and slices may come from earlier Plan revisions. Invalid records exit non-zero before any report is written.

```sh
orbit progress --root orbit
orbit progress --root orbit --plan <plan-id> --output orbit/progress.md --direction TD
```

## 9. Sync a slice to GitHub

Run this only after the slice file exists and `orbit validate --all --root orbit` has succeeded for that slice. Never create the GitHub issue first.

Preview the issue. This performs no authentication and no GitHub calls:

```sh
orbit sync github --plan <file> --snapshot <file> --reconciliation <file> --slice <file> --repo <owner/name> [--project-owner <owner> --project-number <number>] [--issue <number>] --dry-run
```

Required: `--plan`, `--snapshot`, `--reconciliation`, `--slice`, `--repo`. `--repo` is `owner/name`. Optional: `--project-owner`, `--project-number`, `--issue`, `--dry-run`. `--dry-run` takes no value. `--project-number` requires `--project-owner`. `--issue <number>` updates that issue instead of creating one.

Show the dry-run JSON to the user. Remove `--dry-run` only after the user reviews the proposed issue. A real write needs an authenticated GitHub CLI (`gh auth login`). The command rejects an inconsistent project, Plan revision, outcome, acceptance criterion, incomplete Reconciliation assessment, or repository provenance before it calls GitHub.

```sh
orbit sync github \
  --plan orbit/plans/plan-<id>.json \
  --snapshot orbit/snapshots/snapshot-<id>.json \
  --reconciliation orbit/reconciliations/reconciliation-<id>.json \
  --slice orbit/slices/slice-<id>.json \
  --repo <owner/name> \
  --dry-run
```
