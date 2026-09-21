import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

export async function writeJson(file, value) {
  if (!file) return JSON.stringify(value, null, 2);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
  return file;
}

async function inspectRepository({ repositoryId, repositoryPath }, execCommand) {
  const [{ stdout: branch }, { stdout: commit }] = await Promise.all([
    execCommand('git', ['-C', repositoryPath, 'branch', '--show-current']),
    execCommand('git', ['-C', repositoryPath, 'rev-parse', 'HEAD'])
  ]);
  return { repositoryId, branch: branch.trim() || 'HEAD', commit: commit.trim() };
}

export async function captureProjectSnapshot({ projectId, repositories, id, execCommand = exec, now = () => new Date() }) {
  if (!Array.isArray(repositories) || repositories.length === 0) {
    throw new Error('Project Snapshot capture requires at least one repository.');
  }
  const repositoryIds = new Set();
  for (const repository of repositories) {
    if (!repository?.repositoryId || !repository?.repositoryPath) {
      throw new Error('Each repository requires a repositoryId and repositoryPath.');
    }
    if (repositoryIds.has(repository.repositoryId)) {
      throw new Error(`Project Snapshot capture has duplicate repository id ${repository.repositoryId}.`);
    }
    repositoryIds.add(repository.repositoryId);
  }
  const capturedRepositories = await Promise.all(
    repositories.map(repository => inspectRepository(repository, execCommand))
  );
  return {
    specVersion: '0.1',
    id,
    project: { id: projectId },
    observedAt: now().toISOString(),
    repositories: capturedRepositories
  };
}

export async function captureSnapshot({ projectId, repositoryId, repositoryPath, id, execCommand, now }) {
  return captureProjectSnapshot({
    projectId,
    id,
    repositories: [{ repositoryId, repositoryPath }],
    execCommand,
    now
  });
}

export function buildReconciliation(plan, snapshot, { id }) {
  return {
    specVersion: '0.1',
    id,
    planId: plan.id,
    planRevision: plan.revision,
    projectSnapshotId: snapshot.id,
    reconciledAt: new Date().toISOString(),
    observations: snapshot.repositories.map(repository => `Observed ${repository.repositoryId} at ${repository.commit}.`),
    criterionAssessments: (plan.acceptanceCriteria ?? []).map(criterion => ({
      criterionId: criterion.id,
      status: 'not-verified',
      evidence: [],
      explanation: 'No explicit evidence was supplied for this criterion.'
    }))
  };
}

export function buildSlice(plan, reconciliation, options) {
  return {
    specVersion: '0.1',
    id: options.id,
    planId: plan.id,
    outcomeId: options.outcomeId,
    basedOn: {
      planRevision: plan.revision,
      reconciliationId: reconciliation.id,
      repositories: options.repositories ?? {}
    },
    objective: options.objective,
    why: options.why,
    contributesTo: options.contributesTo ?? [],
    scope: { include: options.include ?? [], exclude: options.exclude ?? [] }
  };
}
