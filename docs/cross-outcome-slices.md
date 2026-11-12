# Cross-outcome Execution Slices

ORBIT 0.2 lets one Execution Slice contribute acceptance criteria from more than one outcome. The slice declares those outcomes in the optional `outcomeIds` field. A slice without `outcomeIds` keeps the single-outcome rule from ORBIT 0.1.

## The rule

An Execution Slice always names a primary outcome in `outcomeId`.

- **Single-outcome slice.** The slice has no `outcomeIds`. Every criterion in `contributesTo` must belong to `outcomeId`. This is the default and the 0.1 behavior.
- **Cross-outcome slice.** The slice has `outcomeIds`. Every criterion in `contributesTo` must belong to an outcome in `outcomeIds`.

A cross-outcome slice must obey these rules:

1. `specVersion` is `0.2`.
2. `outcomeIds` lists at least two outcomes.
3. `outcomeIds` has no duplicate entries.
4. Each entry in `outcomeIds` is an outcome on the Plan revision in `basedOn.planRevision`.
5. `outcomeIds` includes `outcomeId`.
6. Each listed outcome has at least one criterion in `contributesTo`.

The rules for `contributesTo` do not change. Each criterion ID must exist on the Plan revision. A criterion ID must not repeat.

```json
{
  "specVersion": "0.2",
  "id": "slice-walking-skeleton",
  "planId": "plan-walking-skeleton",
  "outcomeId": "browse",
  "outcomeIds": ["browse", "checkout"],
  "contributesTo": ["ac-browse-1", "ac-checkout-1"]
}
```

The complete record is [`examples/slice-walking-skeleton.json`](../examples/slice-walking-skeleton.json).

## Why the declaration is explicit

ORBIT 0.1 refused a criterion from another outcome. That rule also caught a criterion ID copied from the wrong outcome. The `outcomeIds` declaration keeps that check. A slice must name each outcome before it can contribute a criterion of that outcome. An undeclared cross-outcome criterion still fails validation.

Rule 6 keeps the declaration accurate. A slice cannot claim an outcome that it does not advance.

## Attribution

A criterion always belongs to the outcome in its Plan entry. A slice does not change that attribution.

- A Reconciliation assesses each criterion. Its assessments do not reference slices.
- `orbit progress` counts each criterion toward its own outcome. A slice hexagon links to each contributed criterion, so one hexagon can link into several outcomes.
- `orbit status` lists every outcome of a cross-outcome slice, primary outcome first. In `--json` output, a cross-outcome slice adds `outcomeIds`. A single-outcome slice keeps the 0.1 fields.
- `orbit sync github` lists each outcome of a cross-outcome slice with the contributed criteria of that outcome. A single-outcome slice keeps the one `Outcome` line.

A harness that shows one outcome for a slice uses `outcomeId`.

## When to use a cross-outcome slice

Use a single-outcome slice by default. It keeps one change, one review, and one outcome together.

Use a cross-outcome slice when one bounded change must advance several outcomes at the same time. Examples:

- **Walking skeleton.** One thin end-to-end path for each outcome. The paths share one deployable unit, one data store, and one release path. The slice proves the structure before each feature grows. A later Reconciliation finds the difference between the skeleton and each criterion.
- **Shared foundation.** One schema migration or one shared component satisfies criteria in two outcomes. Two slices would describe the same change twice.

Do not use a cross-outcome slice to batch unrelated work. Do not use it to avoid one Reconciliation between two changes.

## Review-size risk

A cross-outcome slice is usually larger than a single-outcome slice. A larger change is harder to review and harder to revert.

Reduce the risk:

1. Keep each path thin. Contribute the fewest criteria that prove each path.
2. Write `scope.exclude` for the work that later slices do.
3. Expect a `partially-verified` assessment for most criteria after a walking skeleton. Cut follow-up slices from the next Reconciliation.
4. Split the slice when a reviewer cannot review it in one session. ORBIT does not set a size limit.

## Spec version

ORBIT uses `major.minor` spec versions in `specVersion`.

- A minor version adds optional features. Every record that is valid under an earlier minor version of the same major version stays valid.
- A record states the lowest spec version whose features it uses.
- A major version may remove or change a feature. ORBIT has no major version above 0 yet.

ORBIT 0.2 adds one feature: `outcomeIds` on an Execution Slice. All four record schemas accept `specVersion` `0.1` and `0.2`. A record that does not use `outcomeIds` can keep `0.1`. `orbit slice` writes `0.2` only when you pass `--outcomes`. The other lifecycle commands still write `0.1`.

A validator that knows only 0.1 rejects a `0.2` record. This is intentional. An old validator cannot check the cross-outcome rules.
