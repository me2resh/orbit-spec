import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGitHubIssuePayload, syncGitHub } from '../lib/github-sync.mjs';

const plan = {
  id: 'plan-1',
  revision: 2,
  project: { id: 'project-1' },
  outcomes: [{ id: 'outcome-1' }],
  acceptanceCriteria: [{ id: 'ac-1', outcomeId: 'outcome-1' }]
};
const snapshot = {
  id: 'snapshot-1',
  project: { id: 'project-1' },
  repositories: [{ repositoryId: 'demo', branch: 'main', commit: 'abc123' }]
};
const reconciliation = {
  id: 'reconciliation-1',
  planId: 'plan-1',
  planRevision: 2,
  projectSnapshotId: 'snapshot-1',
  criterionAssessments: [{ criterionId: 'ac-1', status: 'not-verified', evidence: [] }]
};
const slice = {
  id: 'slice-1',
  planId: 'plan-1',
  outcomeId: 'outcome-1',
  objective: 'Add the audit history view',
  why: 'The reconciliation found no operator review surface.',
  basedOn: { planRevision: 2, reconciliationId: 'reconciliation-1', repositories: { demo: 'abc123' } },
  contributesTo: ['ac-1'],
  scope: { include: ['Recent events'], exclude: ['Editing events'] }
};

test('builds a GitHub issue payload with Orbit provenance', () => {
  const payload = buildGitHubIssuePayload({ plan, reconciliation, slice });
  assert.equal(payload.title, '[Slice] Add the audit history view');
  assert.match(payload.body, /Plan: `plan-1` \(revision 2\)/);
  assert.match(payload.body, /Reconciliation: `reconciliation-1`/);
  assert.match(payload.body, /demo: `abc123`/);
  assert.match(payload.body, /Recent events/);
});

test('dry-run never invokes GitHub and returns the proposed payload', async () => {
  let invoked = false;
  const result = await syncGitHub({ plan, snapshot, reconciliation, slice, repo: 'me2resh/demo', dryRun: true, execCommand: async () => { invoked = true; } });
  assert.equal(invoked, false);
  assert.equal(result.dryRun, true);
  assert.match(result.body, /Add the audit history view/);
});

test('fails clearly when GitHub authentication is unavailable', async () => {
  await assert.rejects(
    syncGitHub({ plan, snapshot, reconciliation, slice, repo: 'me2resh/demo', execCommand: async () => { throw new Error('not authenticated'); } }),
    /GitHub CLI is not authenticated/
  );
});

test('creates one issue and adds it to Projects v2 when configured', async () => {
  const calls = [];
  const result = await syncGitHub({
    plan, snapshot, reconciliation, slice, repo: 'me2resh/demo', projectOwner: 'me2resh', projectNumber: '7',
    execCommand: async (command, args) => {
      calls.push([command, args]);
      if (args[0] === 'issue') return { stdout: 'https://github.com/me2resh/demo/issues/42\n' };
      return { stdout: '{"id":"PVTI_1"}' };
    }
  });
  assert.equal(result.issueUrl, 'https://github.com/me2resh/demo/issues/42');
  assert.equal(calls.filter(([, args]) => args[0] === 'issue').length, 1);
  assert.equal(calls.filter(([, args]) => args[0] === 'project').length, 1);
});

test('rejects inconsistent record chains before any GitHub call', async () => {
  const invalidCases = [
    { slice: { ...slice, outcomeId: 'missing' } },
    { slice: { ...slice, contributesTo: ['missing'] } },
    { slice: { ...slice, basedOn: { ...slice.basedOn, repositories: { demo: 'stale00' } } } },
    { snapshot: { ...snapshot, project: { id: 'other-project' } } },
    { reconciliation: { ...reconciliation, planId: 'another-plan' } }
  ];
  for (const overrides of invalidCases) {
    let calls = 0;
    await assert.rejects(syncGitHub({
      plan,
      snapshot: overrides.snapshot ?? snapshot,
      reconciliation: overrides.reconciliation ?? reconciliation,
      slice: overrides.slice ?? slice,
      repo: 'me2resh/demo',
      execCommand: async () => { calls += 1; return { stdout: '' }; }
    }), /outcome|criterion|commit|project|plan/i);
    assert.equal(calls, 0);
  }
});

test('rejects incomplete Projects configuration before authentication', async () => {
  let calls = 0;
  await assert.rejects(syncGitHub({
    plan,
    snapshot,
    reconciliation,
    slice,
    repo: 'me2resh/demo',
    projectNumber: '7',
    execCommand: async () => { calls += 1; return { stdout: '' }; }
  }), /project-owner/);
  assert.equal(calls, 0);
});
