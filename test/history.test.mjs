import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { validateRecordRoot } from '../lib/validator.mjs';

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['bin/orbit.js', command, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('close', code => resolve({ code, stdout, stderr }));
    child.on('error', reject);
  });
}

const criterion = { id: 'ac-1', outcomeId: 'outcome-delivery', statement: 'The feature works.' };

const planRevision1 = {
  specVersion: '0.1',
  id: 'plan-history',
  revision: 1,
  project: { id: 'example-project' },
  title: 'History example',
  intent: 'Deliver a bounded change.',
  outcomes: [{ id: 'outcome-delivery', title: 'Delivery' }],
  acceptanceCriteria: [criterion]
};

const planRevision2 = { ...planRevision1, revision: 2, title: 'History example, revised' };

const snapshot = {
  specVersion: '0.1',
  id: 'snapshot-history',
  project: { id: 'example-project' },
  observedAt: '2026-09-14T16:00:00Z',
  repositories: []
};

function reconciliationFor(id, planRevision, reconciledAt) {
  return {
    specVersion: '0.1',
    id,
    planId: 'plan-history',
    planRevision,
    projectSnapshotId: 'snapshot-history',
    reconciledAt,
    observations: [],
    criterionAssessments: [{ criterionId: 'ac-1', status: 'achieved', evidence: ['Tests passed.'] }]
  };
}

const reconciliationRevision1 = reconciliationFor('reconciliation-r1', 1, '2026-09-14T16:05:00Z');
const reconciliationRevision2 = reconciliationFor('reconciliation-r2', 2, '2026-09-20T16:05:00Z');

function sliceFor(id, planRevision, reconciliationId) {
  return {
    specVersion: '0.1',
    id,
    planId: 'plan-history',
    outcomeId: 'outcome-delivery',
    basedOn: { planRevision, reconciliationId, repositories: {} },
    objective: 'Finish the feature.',
    why: 'Current evidence justifies this bounded change.',
    contributesTo: ['ac-1'],
    scope: { include: [], exclude: [] }
  };
}

// A delivered slice keeps the basedOn it was cut from (revision 1).
const deliveredSlice = sliceFor('slice-delivered', 1, 'reconciliation-r1');
const nextSlice = sliceFor('slice-next', 2, 'reconciliation-r2');

// The layout after a Plan revision: revision 2 is current, and the superseded
// revision 1 Plan and Reconciliation live under history/.
function revisedLayout() {
  return {
    'plans/plan-history.r2.json': planRevision2,
    'snapshots/snapshot-history.json': snapshot,
    'reconciliations/reconciliation-r2.json': reconciliationRevision2,
    'slices/slice-delivered.json': deliveredSlice,
    'slices/slice-next.json': nextSlice,
    'history/plans/plan-history.r1.json': planRevision1,
    'history/reconciliations/reconciliation-r1.json': reconciliationRevision1
  };
}

function writeRoot(t, files) {
  const root = mkdtempSync(join(tmpdir(), 'orbit-history-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, value] of Object.entries(files)) {
    if (value === undefined) continue;
    const file = join(root, path);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
  }
  return root;
}

test('validate --all --root accepts a delivered slice whose basedOn names history records', async t => {
  const root = writeRoot(t, revisedLayout());
  const result = await run('validate', ['--all', '--root', root]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Validated 7 ORBIT records/);
  const records = await validateRecordRoot(root);
  assert.deepEqual(records.filter(record => record.history).map(record => record.value.id).sort(), ['plan-history', 'reconciliation-r1']);
});

test('validate --all --root still rejects a dangling basedOn reference', async t => {
  const root = writeRoot(t, {
    ...revisedLayout(),
    'history/reconciliations/reconciliation-r1.json': undefined
  });
  const result = await run('validate', ['--all', '--root', root]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /execution slice slice-delivered references missing reconciliation reconciliation-r1/);

  const missingRevision = writeRoot(t, {
    ...revisedLayout(),
    'history/plans/plan-history.r1.json': undefined
  });
  const revisionResult = await run('validate', ['--all', '--root', missingRevision]);
  assert.equal(revisionResult.code, 1);
  assert.match(revisionResult.stderr, /reconciliation reconciliation-r1 does not reference the plan revision/);
});

test('validate --all --root rejects two current revisions of one Plan', async t => {
  const root = writeRoot(t, {
    ...revisedLayout(),
    'plans/plan-history.r1.json': planRevision1,
    'history/plans/plan-history.r1.json': undefined
  });
  const result = await run('validate', ['--all', '--root', root]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /plan plan-history has more than one current revision/);
});

test('validate --all --root rejects a duplicate id and revision across history and current records', async t => {
  const plan = writeRoot(t, { ...revisedLayout(), 'history/plans/plan-history.r2.json': planRevision2 });
  const planResult = await run('validate', ['--all', '--root', plan]);
  assert.equal(planResult.code, 1);
  assert.match(planResult.stderr, /duplicate plan record id plan-history at revision 2/);

  const reconciliation = writeRoot(t, { ...revisedLayout(), 'history/reconciliations/reconciliation-r2.json': reconciliationRevision2 });
  const reconciliationResult = await run('validate', ['--all', '--root', reconciliation]);
  assert.equal(reconciliationResult.code, 1);
  assert.match(reconciliationResult.stderr, /duplicate reconciliation record id reconciliation-r2/);
});

test('validate --all --root rejects a current record that depends on a history record outside basedOn', async t => {
  const plan = writeRoot(t, {
    ...revisedLayout(),
    'reconciliations/reconciliation-stale.json': reconciliationFor('reconciliation-stale', 1, '2026-09-21T16:05:00Z')
  });
  const planResult = await run('validate', ['--all', '--root', plan]);
  assert.equal(planResult.code, 1);
  assert.match(planResult.stderr, /reconciliation reconciliation-stale plan plan-history revision 1 is a history record/);

  const snapshotRoot = writeRoot(t, {
    ...revisedLayout(),
    'snapshots/snapshot-history.json': undefined,
    'history/snapshots/snapshot-history.json': snapshot
  });
  const snapshotResult = await run('validate', ['--all', '--root', snapshotRoot]);
  assert.equal(snapshotResult.code, 1);
  assert.match(snapshotResult.stderr, /reconciliation reconciliation-r2 project snapshot snapshot-history is a history record/);
});

test('validate --all --root schema-validates history records', async t => {
  const root = writeRoot(t, {
    ...revisedLayout(),
    'history/plans/plan-history.r1.json': { ...planRevision1, revision: 'not-a-number' }
  });
  const result = await run('validate', ['--all', '--root', root]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /ORBIT validation failed/);
  assert.match(result.stderr, /history[/\\]plans[/\\]plan-history\.r1\.json/);
});

test('progress ignores history records when it selects the current Plan revision and Reconciliation', async t => {
  const root = writeRoot(t, {
    ...revisedLayout(),
    'history/plans/plan-history.r9.json': { ...planRevision1, revision: 9, title: 'History only' },
    'history/reconciliations/reconciliation-late.json': reconciliationFor('reconciliation-late', 1, '2026-12-01T00:00:00Z')
  });
  const result = await run('progress', ['--root', root]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^# History example, revised \(revision 2\)/);
  assert.match(result.stdout, /Reconciliation: reconciliation-r2 /);
  assert.doesNotMatch(result.stdout, /History only|reconciliation-late/);
});
