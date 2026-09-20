import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { validateReferences } from '../lib/validator.mjs';
import { buildReconciliation, buildSlice } from '../lib/lifecycle.mjs';

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

test('adapter contract: every standard operation validates its fixture', async () => {
  const cases = [
    ['plan', 'examples/plan-minimal.json'],
    ['snapshot', 'examples/project-snapshot-minimal.json'],
    ['reconcile', 'examples/reconciliation-minimal.json'],
    ['slice', 'examples/slice-minimal.json']
  ];
  for (const [command, file] of cases) {
    const result = await run(command, [file]);
    assert.equal(result.code, 0, `${command}: ${result.stderr}`);
  }
});

test('generic adapter contract validates the complete repository', async () => {
  const result = await run('validate', ['--all']);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Validated \d+ ORBIT records/);
});

test('cross-record validation rejects a missing snapshot reference', () => {
  assert.throws(() => validateReferences([
    { kind: 'plan', value: { id: 'plan-1', revision: 1 } },
    { kind: 'reconciliation', value: { id: 'reconciliation-1', planId: 'plan-1', planRevision: 1, projectSnapshotId: 'missing' } }
  ]), /missing project snapshot/);
});

test('cross-record validation rejects missing reconciliations and stale plan revisions', () => {
  const plan = { kind: 'plan', value: { id: 'plan-1', revision: 2 } };
  assert.throws(() => validateReferences([
    plan,
    { kind: 'slice', value: { id: 'slice-1', planId: 'plan-1', basedOn: { planRevision: 2, reconciliationId: 'missing' } } }
  ]), /missing reconciliation/);
  assert.throws(() => validateReferences([
    plan,
    { kind: 'reconciliation', value: { id: 'reconciliation-1', planId: 'plan-1', planRevision: 1, projectSnapshotId: 'snapshot-1' } },
    { kind: 'snapshot', value: { id: 'snapshot-1' } }
  ]), /does not reference the plan revision/);
});

test('cross-record validation rejects duplicate IDs within a record set', () => {
  assert.throws(() => validateReferences([
    { kind: 'plan', value: { id: 'plan-1', revision: 1 } },
    { kind: 'plan', value: { id: 'plan-1', revision: 1 } }
  ]), /duplicate plan record id/);
});

test('lifecycle builders preserve plan and reconciliation provenance', () => {
  const plan = { id: 'plan-1', revision: 3, acceptanceCriteria: [{ id: 'ac-1' }] };
  const snapshot = { id: 'snapshot-1', repositories: [{ repositoryId: 'app', commit: 'abcdef1' }] };
  const reconciliation = buildReconciliation(plan, snapshot, { id: 'reconciliation-1' });
  assert.equal(reconciliation.planRevision, 3);
  assert.equal(reconciliation.criterionAssessments[0].status, 'not-verified');
  const slice = buildSlice(plan, reconciliation, { id: 'slice-1', outcomeId: 'outcome-1', objective: 'Bounded change', why: 'Evidence supports it' });
  assert.equal(slice.basedOn.reconciliationId, 'reconciliation-1');
  assert.equal(slice.basedOn.planRevision, 3);
});
