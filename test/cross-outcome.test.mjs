import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { sliceOutcomeIds, validateFile, validateRecordRoot, validateReferences } from '../lib/validator.mjs';
import { buildSlice } from '../lib/lifecycle.mjs';
import { buildGitHubIssuePayload } from '../lib/github-sync.mjs';
import { buildProgress } from '../lib/progress.mjs';
import { buildStatus, renderStatus } from '../lib/status.mjs';

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['bin/orbit.js', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('close', code => resolve({ code, stdout, stderr }));
    child.on('error', reject);
  });
}

const example = name => JSON.parse(readFileSync(join('examples', name), 'utf8'));
const plan = example('plan-walking-skeleton.json');
const snapshot = example('project-snapshot-walking-skeleton.json');
const reconciliation = example('reconciliation-walking-skeleton.json');
const crossSlice = example('slice-walking-skeleton.json');

// A 0.1 single-outcome slice on the same Plan.
const singleSlice = {
  specVersion: '0.1',
  id: 'slice-browse-only',
  planId: plan.id,
  outcomeId: 'browse',
  basedOn: { planRevision: 1, reconciliationId: reconciliation.id, repositories: {} },
  objective: 'Add the catalogue page.',
  why: 'No catalogue page exists.',
  contributesTo: ['ac-browse-1', 'ac-browse-2'],
  scope: { include: [], exclude: [] }
};

function chain(slice) {
  return [
    { kind: 'plan', value: plan },
    { kind: 'snapshot', value: snapshot },
    { kind: 'reconciliation', value: reconciliation },
    { kind: 'slice', value: slice }
  ];
}

function tempFile(t, name, value) {
  const directory = mkdtempSync(join(tmpdir(), 'orbit-cross-outcome-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, name);
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  return file;
}

function recordRoot(t, slices) {
  const root = mkdtempSync(join(tmpdir(), 'orbit-cross-outcome-root-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const records = {
    plans: [plan],
    snapshots: [snapshot],
    reconciliations: [reconciliation],
    slices
  };
  for (const [directory, values] of Object.entries(records)) {
    mkdirSync(join(root, directory));
    for (const value of values) writeFileSync(join(root, directory, `${value.id}.json`), `${JSON.stringify(value, null, 2)}\n`);
  }
  return root;
}

// Old shape: every existing 0.1 record keeps its meaning.

test('a 0.1 single-outcome slice validates unchanged', () => {
  assert.doesNotThrow(() => validateReferences(chain(singleSlice)));
});

test('a slice without outcomeIds still fails when a criterion belongs to another outcome', () => {
  const slice = { ...singleSlice, contributesTo: ['ac-browse-1', 'ac-checkout-1'] };
  assert.throws(() => validateReferences(chain(slice)), /criterion ac-checkout-1 belongs to outcome checkout$/);
});

test('a 0.2 slice without outcomeIds keeps the single-outcome rule', () => {
  assert.doesNotThrow(() => validateReferences(chain({ ...singleSlice, specVersion: '0.2' })));
  const slice = { ...singleSlice, specVersion: '0.2', contributesTo: ['ac-checkout-1'] };
  assert.throws(() => validateReferences(chain(slice)), /belongs to outcome checkout/);
});

test('every 0.1 package example and orbit record still validates', async () => {
  const { stdout, code } = await run(['validate', '--all']);
  assert.equal(code, 0);
  assert.match(stdout, /Validated \d+ ORBIT records\./);
});

// New shape: a cross-outcome slice.

test('a 0.2 slice with outcomeIds may contribute criteria from several outcomes', async () => {
  assert.doesNotThrow(() => validateReferences(chain(crossSlice)));
  const { kind } = await validateFile('examples/slice-walking-skeleton.json');
  assert.equal(kind, 'slice');
});

test('sliceOutcomeIds puts the primary outcome first', () => {
  assert.deepEqual(sliceOutcomeIds(singleSlice), ['browse']);
  assert.deepEqual(sliceOutcomeIds({ ...crossSlice, outcomeId: 'checkout' }), ['checkout', 'browse']);
});

test('every record kind accepts specVersion 0.2 and rejects an unknown version', async t => {
  for (const [name, value] of [
    ['plan-v2.json', plan],
    ['project-snapshot-v2.json', snapshot],
    ['reconciliation-v2.json', reconciliation],
    ['slice-v2.json', singleSlice]
  ]) {
    await validateFile(tempFile(t, name, { ...value, specVersion: '0.2' }));
    await assert.rejects(validateFile(tempFile(t, name, { ...value, specVersion: '0.3' })), /specVersion/);
  }
});

// Invalid cross-outcome slices.

test('the schema rejects outcomeIds on a 0.1 slice', async t => {
  await assert.rejects(validateFile(tempFile(t, 'slice-old.json', { ...crossSlice, specVersion: '0.1' })), /specVersion/);
  assert.throws(() => validateReferences(chain({ ...crossSlice, specVersion: '0.1' })), /uses outcomeIds, which needs specVersion 0\.2/);
});

test('the schema rejects a duplicate or a single entry in outcomeIds', async t => {
  await assert.rejects(validateFile(tempFile(t, 'slice-dup.json', { ...crossSlice, outcomeIds: ['browse', 'browse'] })), /duplicate items/);
  await assert.rejects(validateFile(tempFile(t, 'slice-one.json', { ...crossSlice, outcomeIds: ['browse'] })), /fewer than 2 items/);
});

test('the reference check rejects a duplicate or a single entry in outcomeIds', () => {
  assert.throws(() => validateReferences(chain({ ...crossSlice, outcomeIds: ['browse', 'checkout', 'browse'] })), /repeats outcome browse in outcomeIds/);
  assert.throws(() => validateReferences(chain({ ...crossSlice, outcomeIds: ['browse'], contributesTo: ['ac-browse-1'] })), /must list at least two outcomes/);
});

test('outcomeIds must name known outcomes', () => {
  const slice = { ...crossSlice, outcomeIds: ['browse', 'checkout', 'returns'] };
  assert.throws(() => validateReferences(chain(slice)), /references unknown outcome returns in outcomeIds/);
});

test('outcomeIds must include the primary outcome', () => {
  const slice = { ...crossSlice, outcomeId: 'browse', outcomeIds: ['checkout', 'other'] };
  const extendedPlan = { ...plan, outcomes: [...plan.outcomes, { id: 'other', title: 'Other' }] };
  const records = chain(slice).map(record => (record.kind === 'plan' ? { kind: 'plan', value: extendedPlan } : record));
  assert.throws(() => validateReferences(records), /outcomeIds does not include its primary outcome browse/);
});

test('a contributed criterion must belong to a listed outcome', () => {
  const extendedPlan = {
    ...plan,
    outcomes: [...plan.outcomes, { id: 'returns', title: 'Returns' }],
    acceptanceCriteria: [...plan.acceptanceCriteria, { id: 'ac-returns-1', outcomeId: 'returns', statement: 'A return works.' }]
  };
  const extendedReconciliation = {
    ...reconciliation,
    criterionAssessments: [...reconciliation.criterionAssessments, { criterionId: 'ac-returns-1', status: 'not-verified', evidence: [], explanation: 'None.' }]
  };
  const slice = { ...crossSlice, contributesTo: ['ac-browse-1', 'ac-checkout-1', 'ac-returns-1'] };
  const records = [
    { kind: 'plan', value: extendedPlan },
    { kind: 'snapshot', value: snapshot },
    { kind: 'reconciliation', value: extendedReconciliation },
    { kind: 'slice', value: slice }
  ];
  assert.throws(() => validateReferences(records), /criterion ac-returns-1 belongs to outcome returns, which outcomeIds does not list/);
});

test('each listed outcome needs at least one contributed criterion', () => {
  const slice = { ...crossSlice, contributesTo: ['ac-browse-1'] };
  assert.throws(() => validateReferences(chain(slice)), /lists outcome checkout in outcomeIds but contributes no criterion of it/);
});

test('a cross-outcome slice still rejects an unknown or a repeated criterion', () => {
  assert.throws(() => validateReferences(chain({ ...crossSlice, contributesTo: ['ac-browse-1', 'ac-checkout-9'] })), /references unknown criterion ac-checkout-9/);
  assert.throws(() => validateReferences(chain({ ...crossSlice, contributesTo: ['ac-browse-1', 'ac-checkout-1', 'ac-browse-1'] })), /repeats contributed criterion ac-browse-1/);
});

// Lifecycle and CLI.

test('buildSlice writes 0.1 without outcomeIds and 0.2 with them', () => {
  const single = buildSlice(plan, reconciliation, { id: 's1', outcomeId: 'browse', objective: 'o', why: 'w' });
  assert.equal(single.specVersion, '0.1');
  assert.equal('outcomeIds' in single, false);
  const cross = buildSlice(plan, reconciliation, { id: 's2', outcomeId: 'browse', outcomeIds: ['browse', 'checkout'], objective: 'o', why: 'w' });
  assert.equal(cross.specVersion, '0.2');
  assert.deepEqual(cross.outcomeIds, ['browse', 'checkout']);
});

test('orbit slice --outcomes writes a valid cross-outcome slice', async t => {
  const root = recordRoot(t, []);
  const output = join(root, 'slices', 'slice-cli.json');
  const result = await run([
    'slice', '--plan', join(root, 'plans', `${plan.id}.json`),
    '--reconciliation', join(root, 'reconciliations', `${reconciliation.id}.json`),
    '--outcome', 'browse', '--outcomes', 'browse,checkout',
    '--contributes', 'ac-browse-1,ac-checkout-1',
    '--objective', 'Thin path', '--why', 'No code exists.', '--id', 'slice-cli', '--output', output
  ]);
  assert.equal(result.code, 0, result.stderr);
  const written = JSON.parse(readFileSync(output, 'utf8'));
  assert.equal(written.specVersion, '0.2');
  assert.deepEqual(written.outcomeIds, ['browse', 'checkout']);
  await validateRecordRoot(root);
});

test('orbit slice rejects --outcomes without a value', async () => {
  const result = await run([
    'slice', '--plan', 'examples/plan-walking-skeleton.json', '--reconciliation', 'examples/reconciliation-walking-skeleton.json',
    '--outcome', 'browse', '--objective', 'o', '--why', 'w', '--outcomes'
  ]);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /\[--outcomes <id,id>\]/);
});

// Attribution: each criterion counts for its own outcome.

test('progress attributes each contributed criterion to its own outcome', async t => {
  const root = recordRoot(t, [crossSlice]);
  const markdown = await buildProgress({ recordRoot: root });
  assert.match(markdown, /outcome_browse --> criterion_ac_browse_1/);
  assert.match(markdown, /outcome_checkout --> criterion_ac_checkout_1/);
  assert.match(markdown, /slice_slice_walking_skeleton --> criterion_ac_browse_1/);
  assert.match(markdown, /slice_slice_walking_skeleton --> criterion_ac_checkout_1/);
  assert.match(markdown, /\| ac-checkout-1 \| checkout \|/);
});

test('status lists every outcome of a cross-outcome slice and keeps the 0.1 shape', async t => {
  const root = recordRoot(t, [crossSlice, singleSlice]);
  const status = await buildStatus({ recordRoot: root });
  const byId = Object.fromEntries(status.slices.map(slice => [slice.id, slice]));
  assert.deepEqual(byId['slice-walking-skeleton'].outcomeIds, ['browse', 'checkout']);
  assert.equal(byId['slice-walking-skeleton'].outcomeId, 'browse');
  assert.deepEqual(Object.keys(byId['slice-browse-only']), ['id', 'outcomeId', 'reconciliationId', 'objective']);
  const markdown = renderStatus(status);
  assert.match(markdown, /\| slice-walking-skeleton \| browse, checkout \|/);
  assert.match(markdown, /\| slice-browse-only \| browse \|/);
});

test('the GitHub issue body lists each outcome with its own criteria', () => {
  const { body } = buildGitHubIssuePayload({ plan, reconciliation, slice: crossSlice });
  assert.match(body, /- Outcomes:\n {2}- `browse` \(primary\): `ac-browse-1`\n {2}- `checkout`: `ac-checkout-1`/);
  const single = buildGitHubIssuePayload({ plan, reconciliation, slice: singleSlice }).body;
  assert.match(single, /- Outcome: `browse`\n/);
  assert.doesNotMatch(single, /Outcomes:/);
});
