import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const defaultExec = promisify(execFile);

function code(value) {
  return `${String.fromCharCode(96)}${value}${String.fromCharCode(96)}`;
}

function provenanceLines({ plan, reconciliation, slice }) {
  const repositories = Object.entries(slice.basedOn?.repositories ?? {})
    .map(([repository, commit]) => `- ${repository}: ${code(commit)}`)
    .join('\n');
  return [
    `- Plan: ${code(plan.id)} (revision ${plan.revision})`,
    `- Reconciliation: ${code(reconciliation?.id ?? slice.basedOn?.reconciliationId ?? 'not supplied')}`,
    `- Snapshot: ${code(reconciliation?.projectSnapshotId ?? 'not supplied')}`,
    repositories || '- Repository commits: not supplied'
  ].join('\n');
}

export function buildGitHubIssuePayload({ plan, reconciliation, slice }) {
  const title = `[Slice] ${slice.objective}`;
  const include = slice.scope?.include?.length ? slice.scope.include.map((item) => `- ${item}`).join('\n') : '- None recorded';
  const exclude = slice.scope?.exclude?.length ? slice.scope.exclude.map((item) => `- ${item}`).join('\n') : '- None recorded';
  const body = [
    `## Orbit Execution Slice`,
    '',
    slice.objective,
    '',
    `### Why now`,
    slice.why,
    '',
    `### Scope`,
    `**Includes**`,
    include,
    '',
    `**Excludes**`,
    exclude,
    '',
    `### Provenance`,
    provenanceLines({ plan, reconciliation, slice }),
    '',
    `### Orbit identifiers`,
    `- Slice: \`${slice.id}\``,
    `- Outcome: \`${slice.outcomeId}\``,
    '',
    `This issue was proposed from an Orbit reconciliation. Review the linked records before execution.`
  ].join('\n');
  return { title, body };
}

function outputText(result) {
  return `${result.stdout ?? ''}`.trim();
}

export async function syncGitHub({ plan, reconciliation, slice, repo, projectOwner, projectNumber, issueNumber, dryRun = false, execCommand = defaultExec }) {
  if (!repo) throw new Error('GitHub sync requires --repo <owner/name>.');
  const payload = buildGitHubIssuePayload({ plan, reconciliation, slice });
  if (dryRun) return { dryRun: true, repo, issueNumber: issueNumber ?? null, projectNumber: projectNumber ?? null, ...payload };

  try {
    await execCommand('gh', ['auth', 'status']);
  } catch {
    throw new Error('GitHub CLI is not authenticated. Run `gh auth login` and retry.');
  }

  let issueUrl;
  if (issueNumber) {
    await execCommand('gh', ['issue', 'edit', String(issueNumber), '--repo', repo, '--title', payload.title, '--body', payload.body]);
    issueUrl = `https://github.com/${repo}/issues/${issueNumber}`;
  } else {
    const result = await execCommand('gh', ['issue', 'create', '--repo', repo, '--title', payload.title, '--body', payload.body]);
    issueUrl = outputText(result).split('\n').at(-1);
    if (!issueUrl || !issueUrl.startsWith('http')) throw new Error('GitHub did not return the created issue URL.');
  }

  let projectItem = null;
  if (projectNumber !== undefined) {
    if (!projectOwner) throw new Error('Projects v2 sync requires --project-owner <owner>.');
    const result = await execCommand('gh', ['project', 'item-add', String(projectNumber), '--owner', projectOwner, '--url', issueUrl, '--format', 'json']);
    projectItem = outputText(result) || 'added';
  }

  return { dryRun: false, repo, issueUrl, issueNumber: issueNumber ?? null, projectNumber: projectNumber ?? null, projectItem };
}
