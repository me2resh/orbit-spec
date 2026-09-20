import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { validateRecordRoot, validateReferences } from '../lib/validator.mjs';
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

const minimalPlan = {
  specVersion: '0.1',
  id: 'plan-minimal',
  revision: 1,
  project: { id: 'example-project' },
  title: 'Example plan',
  intent: 'Describe one durable planning intent.',
  outcomes: [],
  acceptanceCriteria: []
};

const minimalSnapshot = {
  specVersion: '0.1',
  id: 'snapshot-minimal',
  project: { id: 'example-project' },
  observedAt: '2026-09-14T16:00:00Z',
  repositories: []
};

const minimalReconciliation = {
  specVersion: '0.1',
  id: 'reconciliation-minimal',
  planId: 'plan-minimal',
  planRevision: 1,
  projectSnapshotId: 'snapshot-minimal',
  reconciledAt: '2026-09-14T16:05:00Z',
  observations: [],
  criterionAssessments: []
};

const minimalSlice = {
  specVersion: '0.1',
  id: 'slice-minimal',
  planId: 'plan-minimal',
  outcomeId: 'outcome-pending',
  basedOn: {
    planRevision: 1,
    reconciliationId: 'reconciliation-minimal',
    repositories: {}
  },
  objective: 'Describe one bounded change.',
  why: 'Current evidence justifies this bounded change.',
  contributesTo: [],
  scope: { include: [], exclude: [] }
};

function writeProjectRoot(overrides = {}) {
  const rootDir = mkdtempSync(join(tmpdir(), 'orbit-root-'));
  for (const directory of ['plans', 'snapshots', 'reconciliations', 'slices']) {
    mkdirSync(join(rootDir, directory));
  }
  const records = {
    plans: { 'plan-minimal.json': overrides.plan ?? minimalPlan },
    snapshots: { 'snapshot-minimal.json': overrides.snapshot ?? minimalSnapshot },
    reconciliations: { 'reconciliation-minimal.json': overrides.reconciliation ?? minimalReconciliation },
    slices: { 'slice-minimal.json': overrides.slice ?? minimalSlice }
  };
  for (const [directory, files] of Object.entries(records)) {
    for (const [name, value] of Object.entries(files)) {
      if (value === null) continue;
      writeFileSync(join(rootDir, directory, name), `${JSON.stringify(value, null, 2)}\n`);
    }
  }
  return rootDir;
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

test('validate --all --root accepts a valid project record set', async () => {
  const rootDir = writeProjectRoot();
  try {
    const result = await run('validate', ['--all', '--root', rootDir]);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Validated 4 ORBIT records/);
    const records = await validateRecordRoot(rootDir);
    assert.equal(records.length, 4);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test('validate --all --root does not read package fixture records', async () => {
  const rootDir = writeProjectRoot({
    plan: { ...minimalPlan, id: 'plan-project-only', title: 'Project-only plan' },
    reconciliation: { ...minimalReconciliation, id: 'reconciliation-project-only', planId: 'plan-project-only' },
    slice: {
      ...minimalSlice,
      id: 'slice-project-only',
      planId: 'plan-project-only',
      basedOn: { ...minimalSlice.basedOn, reconciliationId: 'reconciliation-project-only' }
    }
  });
  try {
    const result = await run('validate', ['--all', '--root', rootDir]);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Validated 4 ORBIT records/);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test('validate --all --root rejects malformed records', async () => {
  const rootDir = writeProjectRoot({
    plan: { ...minimalPlan, revision: 'not-a-number' }
  });
  try {
    const result = await run('validate', ['--all', '--root', rootDir]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /ORBIT validation failed/);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test('validate --all --root rejects duplicate IDs', async () => {
  const rootDir = writeProjectRoot();
  writeFileSync(join(rootDir, 'plans', 'plan-duplicate.json'), `${JSON.stringify(minimalPlan, null, 2)}\n`);
  try {
    const result = await run('validate', ['--all', '--root', rootDir]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /duplicate plan record id/);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test('validate --all --root rejects missing references', async () => {
  const rootDir = writeProjectRoot({
    reconciliation: { ...minimalReconciliation, projectSnapshotId: 'missing-snapshot' }
  });
  try {
    const result = await run('validate', ['--all', '--root', rootDir]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /missing project snapshot/);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test('validate --all --root rejects plan revision mismatches', async () => {
  const rootDir = writeProjectRoot({
    reconciliation: { ...minimalReconciliation, planRevision: 9 }
  });
  try {
    const result = await run('validate', ['--all', '--root', rootDir]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /does not reference the plan revision/);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
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
