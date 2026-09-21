import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
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
  outcomes: [{ id: 'outcome-pending', title: 'One bounded example outcome.' }],
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

function createGitRepository(rootDir, name, content) {
  const repositoryPath = join(rootDir, name);
  mkdirSync(repositoryPath);
  execFileSync('git', ['init', '-b', 'main', repositoryPath], { stdio: 'ignore' });
  execFileSync('git', ['-C', repositoryPath, 'config', 'user.email', 'orbit-tests@example.invalid']);
  execFileSync('git', ['-C', repositoryPath, 'config', 'user.name', 'ORBIT Tests']);
  writeFileSync(join(repositoryPath, 'README.md'), `${content}\n`);
  execFileSync('git', ['-C', repositoryPath, 'add', 'README.md']);
  execFileSync('git', ['-C', repositoryPath, 'commit', '-m', `test: initialise ${name}`], { stdio: 'ignore' });
  return {
    repositoryPath,
    commit: execFileSync('git', ['-C', repositoryPath, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  };
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

test('snapshot preserves one-repository usage and captures two repositories in one valid record', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'orbit-snapshot-'));
  try {
    const web = createGitRepository(rootDir, 'web', 'Web repository');
    const api = createGitRepository(rootDir, 'api', 'API repository');
    const singleOutput = join(rootDir, 'single-snapshot.json');
    const singleResult = await run('snapshot', [
      '--project', 'single-repository-project',
      '--repository', 'web', '--path', web.repositoryPath,
      '--output', singleOutput
    ]);
    assert.equal(singleResult.code, 0, singleResult.stderr);
    assert.deepEqual(JSON.parse(readFileSync(singleOutput, 'utf8')).repositories, [
      { repositoryId: 'web', branch: 'main', commit: web.commit }
    ]);
    const output = join(rootDir, 'snapshot.json');
    const result = await run('snapshot', [
      '--project', 'multi-repository-project',
      '--repository', 'web', '--path', web.repositoryPath,
      '--repository', 'api', '--path', api.repositoryPath,
      '--output', output
    ]);
    assert.equal(result.code, 0, result.stderr);
    const snapshot = JSON.parse(readFileSync(output, 'utf8'));
    assert.deepEqual(snapshot.repositories, [
      { repositoryId: 'web', branch: 'main', commit: web.commit },
      { repositoryId: 'api', branch: 'main', commit: api.commit }
    ]);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test('snapshot writes no output for duplicate identifiers or repository failures', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'orbit-snapshot-failure-'));
  try {
    const web = createGitRepository(rootDir, 'web', 'Web repository');
    const output = join(rootDir, 'snapshot.json');
    const cases = [
      ['--repository', 'web', '--path', web.repositoryPath, '--repository', 'web', '--path', web.repositoryPath],
      ['--repository', 'web', '--path', web.repositoryPath, '--repository', 'api', '--path', join(rootDir, 'missing')]
    ];
    for (const repositoryArguments of cases) {
      const result = await run('snapshot', [
        '--project', 'multi-repository-project',
        ...repositoryArguments,
        '--output', output
      ]);
      assert.equal(result.code, 1);
      assert.equal(existsSync(output), false);
    }
    for (const option of ['--id', '--output']) {
      const result = await run('snapshot', [
        '--project', 'multi-repository-project',
        '--repository', 'web', '--path', web.repositoryPath,
        option
      ]);
      assert.equal(result.code, 1, option);
      assert.match(result.stderr, /Usage: orbit snapshot/);
    }
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
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

test('sync github rejects valueless options before reading records or calling GitHub', async () => {
  const required = [
    'github',
    '--plan', 'examples/plan-sso.json',
    '--snapshot', 'examples/project-snapshot-2026-09-14.json',
    '--reconciliation', 'examples/reconciliation-001.json',
    '--slice', 'examples/slice-001.json',
    '--repo', 'me2resh/demo'
  ];
  for (const option of ['--issue', '--project-number', '--project-owner']) {
    const result = await run('sync', [...required, option]);
    assert.equal(result.code, 1, option);
    assert.match(result.stderr, /Usage: orbit sync github/);
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

test('cross-record validation rejects duplicate outcomes, criteria, and orphan criteria', () => {
  const base = { kind: 'plan', value: minimalPlan };
  assert.throws(() => validateReferences([{
    ...base,
    value: { ...minimalPlan, outcomes: [...minimalPlan.outcomes, minimalPlan.outcomes[0]] }
  }]), /duplicate outcome id/);
  const criterion = { id: 'ac-1', outcomeId: 'outcome-pending', statement: 'One check.' };
  assert.throws(() => validateReferences([{
    ...base,
    value: { ...minimalPlan, acceptanceCriteria: [criterion, criterion] }
  }]), /duplicate acceptance criterion id/);
  assert.throws(() => validateReferences([{
    ...base,
    value: { ...minimalPlan, acceptanceCriteria: [{ ...criterion, outcomeId: 'missing' }] }
  }]), /references missing outcome/);
});

test('cross-record validation rejects project and assessment membership mismatches', () => {
  const criterion = { id: 'ac-1', outcomeId: 'outcome-pending', statement: 'One check.' };
  const plan = { ...minimalPlan, acceptanceCriteria: [criterion] };
  const snapshot = { ...minimalSnapshot, project: { id: 'other-project' } };
  assert.throws(() => validateReferences([
    { kind: 'plan', value: plan },
    { kind: 'snapshot', value: snapshot },
    { kind: 'reconciliation', value: { ...minimalReconciliation, criterionAssessments: [] } }
  ]), /links plan project/);
  const validSnapshot = { ...minimalSnapshot };
  for (const criterionAssessments of [
    [],
    [{ criterionId: 'missing', status: 'not-verified', evidence: [] }],
    [
      { criterionId: 'ac-1', status: 'not-verified', evidence: [] },
      { criterionId: 'ac-1', status: 'not-verified', evidence: [] }
    ]
  ]) {
    assert.throws(() => validateReferences([
      { kind: 'plan', value: plan },
      { kind: 'snapshot', value: validSnapshot },
      { kind: 'reconciliation', value: { ...minimalReconciliation, criterionAssessments } }
    ]), /missing assessments|unknown criterion|duplicate assessment/);
  }
});

test('cross-record validation rejects Slice lineage and provenance mismatches', () => {
  const criterion = { id: 'ac-1', outcomeId: 'outcome-pending', statement: 'One check.' };
  const plan = { ...minimalPlan, acceptanceCriteria: [criterion] };
  const snapshot = {
    ...minimalSnapshot,
    repositories: [{ repositoryId: 'app', branch: 'main', commit: 'abcdef1' }]
  };
  const reconciliation = {
    ...minimalReconciliation,
    criterionAssessments: [{ criterionId: 'ac-1', status: 'not-verified', evidence: [] }]
  };
  const records = (slice) => [
    { kind: 'plan', value: plan },
    { kind: 'snapshot', value: snapshot },
    { kind: 'reconciliation', value: reconciliation },
    { kind: 'slice', value: slice }
  ];
  assert.throws(() => validateReferences(records({ ...minimalSlice, outcomeId: 'missing' })), /unknown outcome/);
  assert.throws(() => validateReferences(records({ ...minimalSlice, contributesTo: ['missing'] })), /unknown criterion/);
  assert.throws(() => validateReferences(records({
    ...minimalSlice,
    contributesTo: ['ac-1'],
    basedOn: { ...minimalSlice.basedOn, repositories: { app: 'stale00' } }
  })), /stale commit/);
  assert.throws(() => validateReferences(records({
    ...minimalSlice,
    contributesTo: ['ac-1'],
    basedOn: { ...minimalSlice.basedOn, repositories: { other: 'abcdef1' } }
  })), /outside its project snapshot/);
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
