# Validation resolves history records read-only

> In the context of a Plan revision that supersedes the Plan and Reconciliation that delivered slices name, facing `validate --all --root` errors that force operators to rewrite delivered provenance, I decided to read records under `<root>/history/` as references only, to keep each slice's original `basedOn`, and accepted a stricter rule of one current revision for each Plan `id`.

## Context

- A Plan revision keeps the Plan `id` and increments `revision`. Each Reconciliation and Execution Slice names the revision that it was cut from.
- Before this change, the validator keyed every record by `id` alone. A second revision of one Plan failed with `duplicate plan record id`.
- Some adopters move the superseded Plan revision and its Reconciliation to `history/`. The validator did not read `history/`. A delivered slice whose `basedOn` named a moved Reconciliation failed with `references missing reconciliation`.
- The only workaround was to rewrite `basedOn` on each delivered slice. The slice then claimed a justification that did not exist when it was cut.
- `orbit progress` reads only `plans/`, `reconciliations/`, and `slices/`. It selects the highest Plan revision and the newest Reconciliation.

## Options Considered

| Option | Pros | Cons |
|---|---|---|
| Keep all revisions in `plans/` and key Plans by `id` and `revision` | No new directory | The current revision is implicit. A current record can silently depend on a superseded revision. |
| Rewrite `basedOn` on delivered slices after each Plan revision | No validator change | Changes delivered provenance. The record no longer shows the evidence that justified the slice. |
| Read `history/` read-only, key Plans by `id` and `revision`, and allow only `basedOn` provenance to resolve to history records | Delivered provenance stays unchanged. The current set stays unambiguous. | Adds one directory to the record-root layout. Adds a rule that limits current records to one revision for each Plan. |

## Decision

Chosen: **read `history/` read-only**, because provenance must stay as it was cut, and the current record set must stay unambiguous.

`orbit validate --all --root <directory>` applies these rules:

1. It reads `plans/`, `snapshots/`, `reconciliations/`, and `slices/` under the root as current records.
2. It reads the same four subdirectories under `<root>/history/` as history records. A missing directory counts as empty.
3. It schema-validates every record, current and history.
4. It keys Plans by `id` and `revision`. It keys other records by `id`. A duplicate key across current and history records fails.
5. It allows at most one current revision for each Plan `id`.
6. A history record can resolve references to any record. History records are never current.
7. A current record can depend on a history record only through `basedOn` on an Execution Slice. The slice's Plan revision, Reconciliation, and that Reconciliation's Project Snapshot can be history records.
8. A current Reconciliation must name a current Plan revision and a current Project Snapshot.

`orbit progress` does not read `history/`. Its selection of the current Plan revision and Reconciliation does not change.

## Consequences

- A delivered slice keeps its original `basedOn` after a Plan revision.
- An operator who keeps two revisions of one Plan in `plans/` gets a clear error that tells them to move the superseded revision to `history/plans/`.
- A dangling reference still fails. A history record that resolves nothing is still schema-validated.
- `validateReferences` accepts an optional `history: true` flag on each record. When a caller omits the flag, the validator treats the record as current.
- The validated record count from `validate --all --root` includes history records.
- The schemas do not change.

## Artifacts

- [Issue #21](https://github.com/me2resh/orbit-spec/issues/21)
- [AgDR-0004](AgDR-0004-explicit-project-record-root.md)
