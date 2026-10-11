# Read-only orbit status command

> In the context of operators who cut slices from a Reconciliation, facing reconciliations that go stale when repositories move on, I decided to add a read-only `orbit status` command that reuses the `progress` summary and counts commits since each observed snapshot commit, accepting that it reports staleness but does not reconcile.

## Context

- `orbit progress` shows criterion status from the latest Reconciliation. It does not show whether that Reconciliation is still current.
- Operators compare each snapshot commit with each repository `HEAD` by hand. With several repositories, this step is slow and easy to skip.
- AgDR-0003 lets the CLI inspect local repositories. It forbids external side effects and inferred decisions.

## Options Considered

| Option | Pros | Cons |
|---|---|---|
| Add repository counts to `orbit progress` | One command | Progress output becomes dependent on local repository state; the report is no longer repeatable from records alone |
| Automatic re-snapshot and re-reconciliation | No manual step | Writes records and infers assessments; conflicts with AgDR-0003 |
| A separate read-only `orbit status` command | `progress` stays repeatable; staleness is visible; no records change | One more command to learn |

## Decision

Chosen: **a separate read-only `orbit status` command**.

Contract:

- Usage: `orbit status --root <directory> [--plan <id>] [--repository <id> --path <git-repo> ...] [--json]`. The flags match `orbit progress` and `orbit snapshot`.
- Plan, Reconciliation and slice selection reuse the `progress` loader. Outcome counts reuse the `progress` calculation. No logic is duplicated.
- The Project Snapshot is the record in `snapshots/` whose ID is the Reconciliation's `projectSnapshotId`.
- For each snapshot repository with a `--path`, the command runs only `git rev-parse HEAD`, `git branch --show-current` and `git rev-list --count <observed>..HEAD`. It does no remote fetch.
- A missing `--path`, a missing directory, a missing `git` command or a failed `git` command gives `not checked` with a reason. These cases do not fail the command.
- A missing Reconciliation or Project Snapshot gives a note, not an error.
- The command writes no file and no record and calls no provider.
- Exit code 0 on success, also when new commits exist. Invalid records or options exit non-zero.
- `--json` prints `plan`, `reconciliation`, `outcomes`, `repositories`, `slices` and `notes`. Each repository has `repositoryId`, `observedBranch`, `observedCommit`, `checked`, `currentBranch`, `head`, `commitsSinceSnapshot` and `note`.

## Consequences

- Operators and adapters see stale reconciliations before they cut a slice.
- `orbit progress` output stays repeatable from records alone.
- Counts reflect the local clone only. A clone that is not fetched can show 0 new commits.
- The command does not decide when to reconcile. Adapters apply that rule.
