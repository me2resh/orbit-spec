import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { buildStatus } from '../lib/status.mjs';

function run(args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['bin/orbit.js', 'status', ...args], { stdio: ['ignore', 'pipe', 'pipe'], env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('close', code => resolve({ code, stdout, stderr }));
    child.on('error', reject);
  });
}

const example = name => JSON.parse(readFileSync(join('examples', name), 'utf8'));

function gitRepository(t, extraCommits) {
  const path = mkdtempSync(join(tmpdir(), 'orbit-status-repo-'));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-C', path, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  git('init', '-b', 'main');
  git('config', 'user.email', 'orbit-tests@example.invalid');
  git('config', 'user.name', 'ORBIT Tests');
  git('commit', '--allow-empty', '-m', 'test: observed commit');
  const observed = git('rev-parse', 'HEAD');
  for (let index = 0; index < extraCommits; index += 1) git('commit', '--allow-empty', '-m', `test: later commit ${index}`);
  return { path, observed, head: git('rev-parse', 'HEAD') };
}

function recordRoot(t, commit, { reconciliation = true, snapshot = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'orbit-status-root-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const records = {
    plans: [example('plan-sso.json')],
    snapshots: snapshot ? [{ ...example('project-snapshot-2026-09-14.json'), repositories: [{ repositoryId: 'web', branch: 'main', commit }] }] : [],
    reconciliations: reconciliation ? [example('reconciliation-001.json')] : [],
    slices: [example('slice-001.json')]
  };
  for (const [directory, values] of Object.entries(records)) {
    mkdirSync(join(root, directory));
    values.forEach((value, index) => writeFileSync(join(root, directory, `${index}.json`), `${JSON.stringify(value, null, 2)}\n`));
  }
  return root;
}

// Checksum every file (path + content) below a directory.
function checksum(directory) {
  const hash = createHash('sha256');
  const walk = path => {
    for (const name of readdirSync(path).sort()) {
      const file = join(path, name);
      if (statSync(file).isDirectory()) walk(file);
      else hash.update(`${relative(directory, file)}\0`).update(readFileSync(file));
    }
  };
  walk(directory);
  return hash.digest('hex');
}

test('status prints plan, reconciliation, outcome counts, commits since snapshot and slices', async t => {
  const repo = gitRepository(t, 3);
  const root = recordRoot(t, repo.observed);
  const result = await run(['--root', root, '--repository', 'web', '--path', repo.path]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^# Corporate SSO \(revision 1\)\n/);
  assert.match(result.stdout, /Plan: plan-sso/);
  assert.match(result.stdout, /Reconciliation: reconciliation-001 \(2026-09-14T16:05:00Z\), Project Snapshot snapshot-2026-09-14/);
  assert.ok(result.stdout.includes('| sso | Corporate users authenticate with SSO. | 50% | 0 | 1 | 1 |'));
  assert.ok(result.stdout.includes(`| web | main | ${repo.observed} | main | ${repo.head} | 3 |`));
  assert.match(result.stdout, /\| slice-001 \| sso \| reconciliation-001 \|/);
});

test('status --json has the same fields and exits 0 with zero new commits', async t => {
  const repo = gitRepository(t, 0);
  const root = recordRoot(t, repo.observed);
  const result = await run(['--root', root, '--repository', 'web', '--path', repo.path, '--json']);
  assert.equal(result.code, 0, result.stderr);
  const status = JSON.parse(result.stdout);
  assert.deepEqual(status.plan, { id: 'plan-sso', revision: 1, title: 'Corporate SSO' });
  assert.deepEqual(status.reconciliation, { id: 'reconciliation-001', reconciledAt: '2026-09-14T16:05:00Z', projectSnapshotId: 'snapshot-2026-09-14' });
  assert.deepEqual(status.outcomes, [{ id: 'sso', title: 'Corporate users authenticate with SSO.', percent: 50, achieved: 0, partial: 1, total: 1 }]);
  assert.deepEqual(status.repositories, [{
    repositoryId: 'web', observedBranch: 'main', observedCommit: repo.observed, checked: true,
    currentBranch: 'main', head: repo.observed, commitsSinceSnapshot: 0, note: null
  }]);
  assert.equal(status.slices[0].id, 'slice-001');
  assert.deepEqual(status.notes, []);
});

test('status writes no files in the record root or the repository', async t => {
  const repo = gitRepository(t, 2);
  const root = recordRoot(t, repo.observed);
  const before = [checksum(root), checksum(repo.path)];
  for (const extra of [[], ['--json']]) {
    const result = await run(['--root', root, '--repository', 'web', '--path', repo.path, ...extra]);
    assert.equal(result.code, 0, result.stderr);
  }
  assert.deepEqual([checksum(root), checksum(repo.path)], before);
});

test('status reports "not checked" for a missing path, a missing --path and a missing git command', async t => {
  const repo = gitRepository(t, 1);
  const root = recordRoot(t, repo.observed);
  const missing = await run(['--root', root, '--repository', 'web', '--path', join(root, 'does-not-exist'), '--json']);
  assert.equal(missing.code, 0, missing.stderr);
  assert.equal(JSON.parse(missing.stdout).repositories[0].note, 'not checked: repository path not found');

  const unpaired = await run(['--root', root]);
  assert.equal(unpaired.code, 0, unpaired.stderr);
  assert.ok(unpaired.stdout.includes('| web | main | '));
  assert.ok(unpaired.stdout.includes('not checked: no --path given'));

  // A PATH with only a fake git that fails, then a PATH with no git at all.
  const bin = mkdtempSync(join(tmpdir(), 'orbit-status-bin-'));
  t.after(() => rmSync(bin, { recursive: true, force: true }));
  writeFileSync(join(bin, 'git'), '#!/bin/sh\necho "fatal: fake git failure" >&2\nexit 128\n');
  chmodSync(join(bin, 'git'), 0o755);
  const failing = await run(['--root', root, '--repository', 'web', '--path', repo.path, '--json'], { ...process.env, PATH: bin });
  assert.equal(failing.code, 0, failing.stderr);
  assert.equal(JSON.parse(failing.stdout).repositories[0].note, 'not checked: fatal: fake git failure');

  const empty = mkdtempSync(join(tmpdir(), 'orbit-status-empty-'));
  t.after(() => rmSync(empty, { recursive: true, force: true }));
  const noGit = await run(['--root', root, '--repository', 'web', '--path', repo.path], { ...process.env, PATH: empty });
  assert.equal(noGit.code, 0, noGit.stderr);
  assert.ok(noGit.stdout.includes('not checked: git command not found'));
});

test('status treats a snapshot commit that looks like a git option as a revision', async t => {
  const repo = gitRepository(t, 1);
  const target = mkdtempSync(join(tmpdir(), 'orbit-status-target-'));
  t.after(() => rmSync(target, { recursive: true, force: true }));
  const root = recordRoot(t, `--output=${join(target, 'created')}`);
  const result = await run(['--root', root, '--repository', 'web', '--path', repo.path, '--json']);
  assert.equal(result.code, 0, result.stderr);
  const [web] = JSON.parse(result.stdout).repositories;
  assert.equal(web.checked, false);
  assert.match(web.note, /^not checked: /);
  assert.deepEqual(readdirSync(target), []);
});

test('status uses an injected git command and reports an unknown observed commit', async t => {
  const repo = gitRepository(t, 0);
  const root = recordRoot(t, 'abc1234');
  const calls = [];
  const execCommand = async (command, args) => {
    calls.push([command, ...args.slice(2)]);
    if (args[2] === 'rev-list') throw Object.assign(new Error('failed'), { stderr: 'fatal: bad revision abc1234..HEAD\n' });
    return { stdout: args[2] === 'rev-parse' ? 'def5678\n' : 'feature\n' };
  };
  const status = await buildStatus({ recordRoot: root, repositoryPaths: { web: repo.path, api: repo.path }, execCommand });
  assert.equal(status.repositories[0].checked, false);
  assert.equal(status.repositories[0].note, 'not checked: fatal: bad revision abc1234..HEAD');
  assert.deepEqual(status.notes, ['Repository api is not in the Project Snapshot; ignored.']);
  // Only read-only git subcommands are used.
  assert.deepEqual(calls.map(call => call[1]).sort(), ['branch', 'rev-list', 'rev-parse']);
});

test('status notes a missing reconciliation or snapshot instead of failing', async t => {
  const noReconciliation = await run(['--root', recordRoot(t, 'abc1234', { reconciliation: false }), '--json']);
  assert.equal(noReconciliation.code, 0, noReconciliation.stderr);
  const first = JSON.parse(noReconciliation.stdout);
  assert.equal(first.reconciliation, null);
  assert.deepEqual(first.notes, ['No reconciliation yet: no Project Snapshot to compare.']);

  const noSnapshot = await run(['--root', recordRoot(t, 'abc1234', { snapshot: false })]);
  assert.equal(noSnapshot.code, 0, noSnapshot.stderr);
  assert.match(noSnapshot.stdout, /Project Snapshot snapshot-2026-09-14 not found in the record root\./);
});

test('status rejects invalid options with usage', async t => {
  const root = recordRoot(t, 'abc1234');
  for (const args of [[], ['--root'], ['--root', root, '--repository', 'web'], ['--root', root, '--json', 'yes'],
    ['--root', root, '--repository', 'web', '--path', '.', '--repository', 'web', '--path', '.']]) {
    const result = await run(args);
    assert.equal(result.code, 1, args.join(' '));
    assert.match(result.stderr, /Usage: orbit status --root <directory>/);
  }
});
