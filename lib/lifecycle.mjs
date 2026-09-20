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

export async function captureSnapshot({ projectId, repositoryId, repositoryPath, id }) {
  const [{ stdout: branch }, { stdout: commit }] = await Promise.all([
    exec('git', ['-C', repositoryPath, 'branch', '--show-current']),
    exec('git', ['-C', repositoryPath, 'rev-parse', 'HEAD'])
  ]);
  return {
    specVersion: '0.1',
    id,
    project: { id: projectId },
    observedAt: new Date().toISOString(),
    repositories: [{ repositoryId, branch: branch.trim() || 'HEAD', commit: commit.trim() }]
  };
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
