# Revising a criterion

A Plan revision is a fixed reference. Reconciliations pin it with `planRevision`. Execution slices pin it with `basedOn.planRevision`. This page tells you when a change needs a new Plan revision. It also tells you how to keep the history clear.

## Terms

| Term | Meaning in this page |
|---|---|
| Statement | The `statement` field of an acceptance criterion. It is the canonical wording of "done". |
| Baseline | The measured starting value that a statement refers to. |
| Target | The value that the statement requires at "done". |
| Plan revision | One Plan record with one `revision` number. |
| Evidence update | A new Reconciliation that changes only status, evidence, or explanation. |

## Rules

1. Do not edit a Plan revision that a Reconciliation or slice references. An edit in place changes what the older records assessed.
2. Create a new Plan revision when a change alters what "done" means.
3. Create a new Plan revision when a change alters the number that a criterion is judged against. A corrected baseline is such a change.
4. Use an evidence update when the statement and its numbers stay the same. Record the new status and evidence in a new Reconciliation. Do not create a Plan revision.
5. Keep the criterion `id` when the criterion assesses the same thing. Use a new `id` only when the criterion assesses a different thing.

| Change | Path |
|---|---|
| New status for an unchanged criterion | Evidence update |
| New or better evidence for an unchanged criterion | Evidence update |
| Corrected baseline value | New Plan revision |
| Changed target value | New Plan revision |
| Changed wording of a statement | New Plan revision |
| Added, removed, or split criterion | New Plan revision |

## Record why a baseline changed

Record the cause in two places:

1. Put a `revisionNote` in the new Plan revision. State which criteria changed, the old value, the new value, and the reason. Refer to the evidence.
2. Add a `discoveries` entry to the next Reconciliation. Include the evidence that shows the old value was wrong, for example the measurement script and its output.

The `revisionNote` tells a reader why the revision exists. The discovery holds the evidence.

## Keep slice provenance across a revision

Do not change a delivered slice to point at the new revision. The slice stays pinned to the revision and Reconciliation that justified it. That pin is its provenance.

The next Reconciliation pins the new revision. It assesses each criterion against the new statement. It can cite the delivered slice and its commits as evidence. New slices pin the new revision.

## Absolute targets do not move

A baseline correction does not loosen a target that is stated as an absolute value. Keep the absolute target unchanged. For example, "at most 50 events" stays "at most 50 events" when the baseline changes.

A target that is stated relative to the baseline changes its absolute value when the baseline changes. For example, "reduce events by 20%" gives a different number. Write the new absolute value in the statement and state the calculation in the `revisionNote`. Do not use a correction to make a target easier than the original intent.

## Worked example

A criterion had a baseline of 469 events per day. A new measurement script showed that the old count included unrelated events. The correct baseline is 420 events per day. The target "at most 50 events per day" is an absolute value.

Revision 1 is referenced by a Reconciliation and a delivered slice. Do not edit it.

```json
{
  "specVersion": "0.1",
  "id": "plan-alerts",
  "revision": 1,
  "project": { "id": "example-project" },
  "title": "Reduce alert noise",
  "intent": "Operators see only actionable alerts.",
  "outcomes": [{ "id": "quiet-alerts", "title": "Alert volume is low and actionable." }],
  "acceptanceCriteria": [
    {
      "id": "ac-volume",
      "outcomeId": "quiet-alerts",
      "statement": "Daily alert events fall from a baseline of 469 to at most 50."
    }
  ]
}
```

Create revision 2. Keep the criterion `id`, because the criterion assesses the same thing. Keep the target at 50.

```json
{
  "specVersion": "0.1",
  "id": "plan-alerts",
  "revision": 2,
  "revisionNote": "ac-volume: baseline corrected from 469 to 420 events per day. The old count included unrelated events. See discovery disc-baseline in reconciliation-002. Target unchanged at 50.",
  "project": { "id": "example-project" },
  "title": "Reduce alert noise",
  "intent": "Operators see only actionable alerts.",
  "outcomes": [{ "id": "quiet-alerts", "title": "Alert volume is low and actionable." }],
  "acceptanceCriteria": [
    {
      "id": "ac-volume",
      "outcomeId": "quiet-alerts",
      "statement": "Daily alert events fall from a baseline of 420 to at most 50."
    }
  ]
}
```

The next Reconciliation pins revision 2 and records the discovery. It cites the delivered slice, which stays pinned to revision 1.

```json
{
  "specVersion": "0.1",
  "id": "reconciliation-002",
  "planId": "plan-alerts",
  "planRevision": 2,
  "projectSnapshotId": "snapshot-002",
  "reconciledAt": "2026-10-01T09:00:00Z",
  "observations": [],
  "criterionAssessments": [
    {
      "criterionId": "ac-volume",
      "status": "partially-verified",
      "evidence": [
        { "kind": "slice", "sliceId": "slice-001", "planRevision": 1 },
        { "kind": "measurement", "script": "scripts/count-alert-events", "value": 120 }
      ],
      "explanation": "Volume fell to 120 events per day. The target is 50."
    }
  ],
  "discoveries": [
    {
      "id": "disc-baseline",
      "summary": "The old baseline of 469 included unrelated events. The corrected baseline is 420.",
      "evidence": [{ "kind": "measurement", "script": "scripts/count-alert-events", "value": 420 }]
    }
  ]
}
```

The shapes of `evidence` and `discoveries` items are open in v0.1. The item fields above are an example, not a requirement.
