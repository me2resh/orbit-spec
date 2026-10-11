import { stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadProgressRecords, markdownText, readRecords, summarizeProgress } from './progress.mjs';

const exec = promisify(execFile);

function firstLine(error) {
  if (error?.code === 'ENOENT') return 'git command not found';
  const detail = String(error?.stderr || error?.message || error).trim().split('\n')[0];
  return detail || 'git command failed';
}

async function isDirectory(path) {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

// Read-only inspection: rev-parse, branch --show-current and rev-list never change a repository.
async function inspectRepository(observed, repositoryPath, execCommand) {
  const result = {
    repositoryId: observed.repositoryId,
    observedBranch: observed.branch,
    observedCommit: observed.commit,
    checked: false,
    currentBranch: null,
    head: null,
    commitsSinceSnapshot: null,
    note: null
  };
  if (repositoryPath === undefined) return { ...result, note: 'not checked: no --path given' };
  if (!await isDirectory(repositoryPath)) return { ...result, note: 'not checked: repository path not found' };
  try {
    const git = args => execCommand('git', ['-C', repositoryPath, ...args]).then(({ stdout }) => String(stdout).trim());
    const [head, currentBranch, count] = await Promise.all([
      git(['rev-parse', 'HEAD']),
      git(['branch', '--show-current']),
      git(['rev-list', '--count', `${observed.commit}..HEAD`])
    ]);
    const commitsSinceSnapshot = Number.parseInt(count, 10);
    if (!Number.isInteger(commitsSinceSnapshot)) throw new Error(`unexpected rev-list output ${JSON.stringify(count)}`);
    return { ...result, checked: true, head, currentBranch: currentBranch || 'HEAD', commitsSinceSnapshot };
  } catch (error) {
    return { ...result, note: `not checked: ${firstLine(error)}` };
  }
}

export async function buildStatus({ recordRoot, planId, repositoryPaths = {}, execCommand = exec }) {
  const { root, plan, reconciliation, slices } = await loadProgressRecords({ recordRoot, planId });
  const { outcomes, outcomeProgress } = summarizeProgress(plan, reconciliation);
  const notes = [];
  let repositories = [];
  if (!reconciliation) {
    notes.push('No reconciliation yet: no Project Snapshot to compare.');
  } else {
    const snapshots = await readRecords(root, 'snapshots', 'snapshot');
    const snapshot = snapshots.find(record => record.id === reconciliation.projectSnapshotId);
    if (!snapshot) {
      notes.push(`Project Snapshot ${reconciliation.projectSnapshotId} not found in the record root.`);
    } else {
      repositories = await Promise.all(snapshot.repositories.map(repository =>
        inspectRepository(repository, repositoryPaths[repository.repositoryId], execCommand)));
    }
  }
  const known = new Set(repositories.map(repository => repository.repositoryId));
  for (const id of Object.keys(repositoryPaths).sort()) {
    if (!known.has(id)) notes.push(`Repository ${id} is not in the Project Snapshot; ignored.`);
  }
  return {
    plan: { id: plan.id, revision: plan.revision, title: plan.title },
    reconciliation: reconciliation
      ? { id: reconciliation.id, reconciledAt: reconciliation.reconciledAt, projectSnapshotId: reconciliation.projectSnapshotId }
      : null,
    outcomes: outcomes.map(outcome => ({ id: outcome.id, ...outcomeProgress.get(outcome.id) })),
    repositories,
    slices: [...slices].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
      .map(slice => ({ id: slice.id, outcomeId: slice.outcomeId, reconciliationId: slice.basedOn.reconciliationId, objective: slice.objective })),
    notes
  };
}

function row(cells) {
  return `| ${cells.map(cell => markdownText(cell ?? '')).join(' | ')} |`;
}

export function renderStatus(status) {
  const { plan, reconciliation } = status;
  const lines = [
    `# ${markdownText(plan.title)} (revision ${plan.revision})`,
    '',
    `Plan: ${markdownText(plan.id)}`,
    reconciliation
      ? `Reconciliation: ${markdownText(reconciliation.id)} (${reconciliation.reconciledAt}), Project Snapshot ${markdownText(reconciliation.projectSnapshotId)}`
      : 'Reconciliation: no reconciliation yet',
    '',
    '## Outcomes',
    '',
    '| ID | Title | Percent | Achieved | Partly | Total |',
    '| --- | --- | --- | --- | --- | --- |',
    ...status.outcomes.map(outcome => row([outcome.id, outcome.title, `${outcome.percent}%`, outcome.achieved, outcome.partial, outcome.total])),
    '',
    '## Repositories',
    ''
  ];
  if (status.repositories.length) {
    lines.push('| Repository | Observed branch | Observed commit | Current branch | HEAD | Commits since snapshot |', '| --- | --- | --- | --- | --- | --- |');
    for (const repository of status.repositories) {
      lines.push(row([
        repository.repositoryId, repository.observedBranch, repository.observedCommit,
        repository.currentBranch ?? '-', repository.head ?? '-',
        repository.checked ? repository.commitsSinceSnapshot : repository.note
      ]));
    }
  } else {
    lines.push('No repositories to check.');
  }
  lines.push('', '## Slices', '');
  if (status.slices.length) {
    lines.push('| ID | Outcome | Based on reconciliation | Objective |', '| --- | --- | --- | --- |');
    for (const slice of status.slices) lines.push(row([slice.id, slice.outcomeId, slice.reconciliationId, slice.objective]));
  } else {
    lines.push('No slices for this Plan.');
  }
  if (status.notes.length) lines.push('', '## Notes', '', ...status.notes.map(note => `- ${markdownText(note)}`));
  lines.push('');
  return lines.join('\n');
}
