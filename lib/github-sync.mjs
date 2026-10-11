import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { validateRecordChain } from './validator.mjs';

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

// A body prefix is plain operator text placed above the generated body.
// It is validated, never rewritten: an invalid prefix fails the command.
export const MAX_BODY_PREFIX_LENGTH = 1024;

// C0 controls except tab (U+0009) and line feed (U+000A), DEL, C1 controls,
// Unicode line/paragraph separators, and bidirectional embedding, override, and isolate controls.
const FORBIDDEN_PREFIX_CHARACTERS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u2028\u2029\u202A-\u202E\u2066-\u2069]/u;

export function validateBodyPrefix(bodyPrefix) {
  if (bodyPrefix === undefined || bodyPrefix === null) return undefined;
  if (typeof bodyPrefix !== 'string') throw new Error('The body prefix must be text.');
  if (bodyPrefix.trim().length === 0) throw new Error('The body prefix must contain text.');
  const length = Array.from(bodyPrefix).length;
  if (length > MAX_BODY_PREFIX_LENGTH) {
    throw new Error(`The body prefix has ${length} characters. The maximum is ${MAX_BODY_PREFIX_LENGTH}.`);
  }
  const match = bodyPrefix.match(FORBIDDEN_PREFIX_CHARACTERS);
  if (match) {
    const codePoint = match[0].codePointAt(0).toString(16).toUpperCase().padStart(4, '0');
    const kind = codePoint === '2028' ? 'line separator' : codePoint === '2029' ? 'paragraph separator' : 'control character';
    throw new Error(`The body prefix contains the ${kind} U+${codePoint}. Remove it and retry.`);
  }
  if (bodyPrefix.startsWith('\n') || bodyPrefix.endsWith('\n')) {
    throw new Error('The body prefix must not start or end with a line break.');
  }
  if (bodyPrefix.startsWith('\uFEFF')) {
    throw new Error('The body prefix must not start with a byte order mark U+FEFF.');
  }
  if (/<[A-Za-z/!?]/.test(bodyPrefix)) {
    throw new Error('The body prefix contains raw HTML. Use &lt; to show a literal < and retry.');
  }
  if (/`{3,}|~{3,}/.test(bodyPrefix)) {
    throw new Error('The body prefix contains a fence marker (three or more backticks or tildes). Remove it and retry.');
  }
  return bodyPrefix;
}

export function buildGitHubIssuePayload({ plan, reconciliation, slice, bodyPrefix }) {
  const prefix = validateBodyPrefix(bodyPrefix);
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
  return { title, body: prefix === undefined ? body : `${prefix}\n\n${body}` };
}

function outputText(result) {
  return `${result.stdout ?? ''}`.trim();
}

export async function syncGitHub({ plan, snapshot, reconciliation, slice, repo, projectOwner, projectNumber, issueNumber, bodyPrefix, dryRun = false, execCommand = defaultExec }) {
  validateRecordChain({ plan, snapshot, reconciliation, slice });
  if (!repo) throw new Error('GitHub sync requires --repo <owner/name>.');
  if (projectNumber !== undefined && !projectOwner) throw new Error('Projects v2 sync requires --project-owner <owner>.');
  const payload = buildGitHubIssuePayload({ plan, reconciliation, slice, bodyPrefix });
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
    const result = await execCommand('gh', ['project', 'item-add', String(projectNumber), '--owner', projectOwner, '--url', issueUrl, '--format', 'json']);
    projectItem = outputText(result) || 'added';
  }

  return { dryRun: false, repo, issueUrl, issueNumber: issueNumber ?? null, projectNumber: projectNumber ?? null, projectItem };
}
