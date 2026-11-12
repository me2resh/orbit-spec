# Cross-outcome Execution Slices

> In the context of work that must advance several outcomes in one bounded change, such as a walking skeleton, facing a validator that refuses any criterion outside the slice's one outcome, I decided to add an optional `outcomeIds` declaration under spec version 0.2 and to keep `outcomeId` as the required primary outcome, and accepted one more field and a spec version bump.

## Context

- An Execution Slice names one `outcomeId`. The validator refuses a contributed criterion that belongs to another outcome.
- The rule keeps a slice small. It also catches a criterion ID copied from the wrong outcome.
- A walking skeleton builds one thin end-to-end path for each outcome in one change. A shared foundation can satisfy criteria in two outcomes.
- Under ORBIT 0.1, an operator splits that change into several slices or records only one outcome. Both choices make the records differ from the real change.
- Every existing slice and project record set must validate without changes.
- The repository had no written versioning rule. All four schemas fixed `specVersion` to `0.1`.

## Options Considered

| Option | Pros | Cons |
|---|---|---|
| Remove the outcome check for every slice | No new field | Loses the wrong-outcome check for all existing slices. A typo in `contributesTo` passes silently. |
| Replace `outcomeId` with an `outcomes` array | One field for every slice | Breaks every existing slice and every harness that reads `outcomeId`. Needs a major version. |
| Keep `outcomeId` and add an `additionalOutcomeIds` array that excludes the primary outcome | No repeated ID | Consumers must join two fields to get the full list. |
| Keep `outcomeId` as the primary outcome and add an optional `outcomeIds` array that includes it | Existing slices keep their meaning. The wrong-outcome check stays unless a slice declares each outcome. Consumers read one complete list. | The primary outcome appears twice. The validator must check that `outcomeIds` includes it. |

## Decision

Chosen: **keep `outcomeId` and add an optional `outcomeIds` that includes it**, because it keeps every 0.1 record valid and keeps the wrong-outcome check as the default.

1. `outcomeIds` is optional. It has at least two unique entries.
2. A slice without `outcomeIds` keeps the 0.1 rule.
3. A slice with `outcomeIds` may contribute criteria from any listed outcome. Each listed outcome needs at least one contributed criterion. `outcomeIds` must include `outcomeId`.
4. `outcomeIds` needs `specVersion` `0.2`. The schema enforces this with `dependentSchemas`. The reference check enforces it again for callers that skip the schema.
5. All four schemas accept `0.1` and `0.2`. A record states the lowest version whose features it uses. The lifecycle commands write `0.1`, except `orbit slice --outcomes`.
6. Attribution stays on the criterion. Progress, status, and GitHub sync attribute each criterion to its own Plan outcome.

## Consequences

- Every 0.1 record validates unchanged. Records written by the CLI without `--outcomes` are byte-identical to 0.1 output.
- A validator that knows only 0.1 rejects a 0.2 record. An old validator cannot check the cross-outcome rules, so a clear version error is safer.
- `orbit status --json` adds `outcomeIds` only for a cross-outcome slice.
- The GitHub issue body lists each outcome and its criteria for a cross-outcome slice. The body for a single-outcome slice does not change.
- The schema `$id` values do not change. They identify the schema documents, not the accepted record versions.
- ORBIT sets no size limit on a cross-outcome slice. The spec text describes the review-size risk.

## Artifacts

- [Issue #46](https://github.com/me2resh/orbit-spec/issues/46)
- [Cross-outcome Execution Slices](../cross-outcome-slices.md)
