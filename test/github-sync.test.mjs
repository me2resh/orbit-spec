import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_BODY_PREFIX_LENGTH, buildGitHubIssuePayload, syncGitHub } from '../lib/github-sync.mjs';

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

const prefix = 'ORBIT slice: slice-1';

function occurrences(text, part) {
  return text.split(part).length - 1;
}

function recordingExec(calls) {
  return async (command, args) => {
    calls.push([command, args]);
    if (args[0] === 'issue' && args[1] === 'create') return { stdout: 'https://github.com/me2resh/demo/issues/42\n' };
    return { stdout: '' };
  };
}

function bodyArgument(calls) {
  const issueCalls = calls.filter(([, args]) => args[0] === 'issue');
  assert.equal(issueCalls.length, 1);
  const args = issueCalls[0][1];
  return args[args.indexOf('--body') + 1];
}

test('dry-run places the body prefix once at the top, followed by one blank line', async () => {
  let invoked = false;
  const result = await syncGitHub({ plan, snapshot, reconciliation, slice, repo: 'me2resh/demo', bodyPrefix: prefix, dryRun: true, execCommand: async () => { invoked = true; } });
  const generated = buildGitHubIssuePayload({ plan, reconciliation, slice }).body;
  assert.equal(invoked, false);
  assert.equal(result.body, `${prefix}\n\n${generated}`);
  assert.ok(result.body.startsWith(`${prefix}\n\n## Orbit Execution Slice`));
  assert.equal(occurrences(result.body, prefix), 1);
});

test('no body prefix leaves the issue body unchanged', async () => {
  const withoutOption = await syncGitHub({ plan, snapshot, reconciliation, slice, repo: 'me2resh/demo', dryRun: true });
  const withUndefined = await syncGitHub({ plan, snapshot, reconciliation, slice, repo: 'me2resh/demo', bodyPrefix: undefined, dryRun: true });
  assert.ok(withoutOption.body.startsWith('## Orbit Execution Slice\n'));
  assert.deepEqual(withUndefined, withoutOption);
  assert.equal(withoutOption.body, buildGitHubIssuePayload({ plan, reconciliation, slice }).body);
});

test('create and edit paths send the same prefixed body as the dry-run preview', async () => {
  const preview = await syncGitHub({ plan, snapshot, reconciliation, slice, repo: 'me2resh/demo', bodyPrefix: prefix, dryRun: true });

  const createCalls = [];
  await syncGitHub({ plan, snapshot, reconciliation, slice, repo: 'me2resh/demo', bodyPrefix: prefix, execCommand: recordingExec(createCalls) });
  const createBody = bodyArgument(createCalls);
  assert.equal(createCalls.find(([, args]) => args[0] === 'issue')[1][1], 'create');
  assert.equal(createBody, preview.body);
  assert.equal(occurrences(createBody, prefix), 1);

  const editCalls = [];
  await syncGitHub({ plan, snapshot, reconciliation, slice, repo: 'me2resh/demo', issueNumber: '42', bodyPrefix: prefix, execCommand: recordingExec(editCalls) });
  const editBody = bodyArgument(editCalls);
  assert.equal(editCalls.find(([, args]) => args[0] === 'issue')[1][1], 'edit');
  assert.equal(editBody, preview.body);
  assert.equal(occurrences(editBody, prefix), 1);
});

test('rejects an invalid body prefix before any GitHub call', async () => {
  const invalidPrefixes = [
    ['bell \u0007 character', /control character U\+0007/],
    ['carriage\r\nreturn', /control character U\+000D/],
    ['escape \u001b[31m', /control character U\+001B/],
    ['override \u202E text', /control character U\+202E/],
    ['x'.repeat(MAX_BODY_PREFIX_LENGTH + 1), /maximum is 1024/],
    ['', /must contain text/],
    ['   ', /must contain text/],
    ['\nleading line break', /start or end with a line break/],
    ['trailing line break\n', /start or end with a line break/],
    [42, /must be text/]
  ];
  for (const [bodyPrefix, message] of invalidPrefixes) {
    for (const dryRun of [true, false]) {
      let calls = 0;
      await assert.rejects(syncGitHub({
        plan, snapshot, reconciliation, slice, repo: 'me2resh/demo', bodyPrefix, dryRun,
        execCommand: async () => { calls += 1; return { stdout: '' }; }
      }), message);
      assert.equal(calls, 0);
    }
  }
});

test('accepts a body prefix at the length limit with tabs and inner line breaks', async () => {
  const multiLine = 'ORBIT slice: slice-1\n\tOwner: platform';
  const result = await syncGitHub({ plan, snapshot, reconciliation, slice, repo: 'me2resh/demo', bodyPrefix: multiLine, dryRun: true });
  assert.ok(result.body.startsWith(`${multiLine}\n\n## Orbit Execution Slice`));
  const longest = 'é'.repeat(MAX_BODY_PREFIX_LENGTH);
  const atLimit = await syncGitHub({ plan, snapshot, reconciliation, slice, repo: 'me2resh/demo', bodyPrefix: longest, dryRun: true });
  assert.ok(atLimit.body.startsWith(longest));
});

test('rejects an inconsistent record chain before any GitHub call when a prefix is set', async () => {
  let calls = 0;
  await assert.rejects(syncGitHub({
    plan, snapshot, reconciliation, slice: { ...slice, outcomeId: 'missing' }, repo: 'me2resh/demo', bodyPrefix: prefix,
    execCommand: async () => { calls += 1; return { stdout: '' }; }
  }), /outcome/i);
  assert.equal(calls, 0);
});
