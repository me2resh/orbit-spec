import { readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { validateFile, validateReferences } from './validator.mjs';

const statuses = {
  'not-verified': { weight: 0, fill: '#e5e7eb', stroke: '#4b5563' },
  'partially-verified': { weight: 0.5, fill: '#fde68a', stroke: '#92400e' },
  achieved: { weight: 1, fill: '#bbf7d0', stroke: '#166534' },
  contradicted: { weight: 0, fill: '#fecaca', stroke: '#991b1b' }
};

function compareIds(left, right) {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

async function readRecords(root, directory, kind) {
  const path = join(root, directory);
  let files;
  try {
    files = await readdir(path);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const records = [];
  for (const file of files.filter(file => file.endsWith('.json')).sort()) {
    const path = join(root, directory, file);
    try {
      records.push((await validateFile(path, kind)).value);
    } catch (error) {
      throw new Error(`Invalid ${kind} record ${path}: ${error.message}`);
    }
  }
  return records;
}

function shortStatement(value) {
  const characters = [...value.replace(/\s+/gu, ' ').trim()];
  if (characters.length <= 45) return characters.join('');
  const prefix = characters.slice(0, 45).join('');
  const boundary = prefix.lastIndexOf(' ');
  // Keep a full word at the limit; hard-cut only when the first word exceeds it.
  const shortened = characters[45] !== ' ' && boundary > 0 ? prefix.slice(0, boundary) : prefix;
  return `${shortened.trimEnd()}…`;
}

function mermaidLabel(value) {
  // Mermaid decodes numeric entities after parsing the quoted label.
  return value.replace(/\s+/gu, ' ').trim()
    .replace(/[^\p{L}\p{N} .,:!?%/…-]/gu, character => `#${character.codePointAt(0)};`);
}

function markdownText(value) {
  return String(value)
    .replace(/[&<>\\`|*_[\]]/g, character => `&#${character.codePointAt(0)};`)
    .replace(/\r\n|\r|\n/g, '<br>');
}

function className(status) {
  return status.replaceAll('-', '_');
}

function renderProgress(plan, reconciliation, slices, direction) {
  validateReferences([{ kind: 'plan', value: plan }]);
  const outcomes = [...plan.outcomes].sort(compareIds);
  const criteria = [...plan.acceptanceCriteria].sort(compareIds);
  const assessments = new Map();
  for (const assessment of reconciliation?.criterionAssessments ?? []) {
    if (assessments.has(assessment.criterionId)) {
      throw new Error(`reconciliation ${reconciliation.id} has duplicate assessment for criterion ${assessment.criterionId}`);
    }
    assessments.set(assessment.criterionId, assessment);
  }
  const statusOf = criterion => assessments.get(criterion.id)?.status ?? 'not-verified';
  const outcomeProgress = new Map(outcomes.map(outcome => {
    const members = criteria.filter(criterion => criterion.outcomeId === outcome.id);
    const achieved = members.filter(criterion => statusOf(criterion) === 'achieved').length;
    const partial = members.filter(criterion => statusOf(criterion) === 'partially-verified').length;
    const weight = members.reduce((sum, criterion) => sum + statuses[statusOf(criterion)].weight, 0);
    const total = members.length;
    const percent = total ? Math.round(weight / total * 100) : 0;
    return [outcome.id, { title: outcome.title, percent, achieved, partial, total }];
  }));

  // Namespaces and suffixes prevent distinct record IDs from collapsing to one node.
  const usedIds = new Set();
  function nodeId(kind, id) {
    const base = `${kind}_${id.replace(/[^a-zA-Z0-9_]/g, '_')}`;
    let candidate = base;
    let suffix = 2;
    while (usedIds.has(candidate)) candidate = `${base}_${suffix++}`;
    usedIds.add(candidate);
    return candidate;
  }
  const planNode = nodeId('plan', plan.id);
  const outcomeNodes = new Map(outcomes.map(outcome => [outcome.id, nodeId('outcome', outcome.id)]));
  const criterionNodes = new Map(criteria.map(criterion => [criterion.id, nodeId('criterion', criterion.id)]));
  const lines = [
    `# ${markdownText(plan.title)} (revision ${plan.revision})`,
    '',
    reconciliation
      ? `Reconciliation: ${markdownText(reconciliation.id)} (${reconciliation.reconciledAt})`
      : 'Reconciliation: no reconciliation yet',
    '',
    '```mermaid',
    `graph ${direction}`,
    `  ${planNode}["${mermaidLabel(plan.id)} (revision ${plan.revision})"]`
  ];
  for (const outcome of outcomes) {
    const { percent, achieved, partial, total } = outcomeProgress.get(outcome.id);
    const node = outcomeNodes.get(outcome.id);
    lines.push(`  ${node}["${mermaidLabel(outcome.id)} · ${percent}% (${achieved} of ${total} achieved, ${partial} partly)"]`);
    lines.push(`  ${planNode} --> ${node}`);
  }
  for (const criterion of criteria) {
    const node = criterionNodes.get(criterion.id);
    lines.push(`  ${node}["${mermaidLabel(criterion.id)}: ${mermaidLabel(shortStatement(criterion.statement))}"]`);
    lines.push(`  ${outcomeNodes.get(criterion.outcomeId)} --> ${node}`);
    lines.push(`  class ${node} ${className(statusOf(criterion))};`);
  }
  const sliceIds = new Set();
  for (const slice of [...slices].sort(compareIds)) {
    if (sliceIds.has(slice.id)) throw new Error(`duplicate slice record id ${slice.id}`);
    sliceIds.add(slice.id);
    const node = nodeId('slice', slice.id);
    lines.push(`  ${node}{{"${mermaidLabel(slice.id)}"}}`);
    for (const criterionId of [...slice.contributesTo].sort()) {
      if (!criterionNodes.has(criterionId)) {
        throw new Error(`execution slice ${slice.id} references unknown criterion ${criterionId} in plan ${plan.id} revision ${plan.revision}`);
      }
      lines.push(`  ${node} --> ${criterionNodes.get(criterionId)}`);
    }
  }
  for (const [status, style] of Object.entries(statuses)) {
    lines.push(`  classDef ${className(status)} fill:${style.fill},stroke:${style.stroke},color:#111827;`);
  }
  lines.push('```', '', '## Outcomes', '', '| ID | Title | Percent | Achieved | Partly | Total |', '| --- | --- | --- | --- | --- | --- |');
  for (const outcome of outcomes) {
    const { percent, achieved, partial, total } = outcomeProgress.get(outcome.id);
    lines.push(`| ${[outcome.id, outcome.title, `${percent}%`, achieved, partial, total].map(markdownText).join(' | ')} |`);
  }
  lines.push('', '## Criteria', '', '| Criterion ID | Outcome ID | Outcome title | Status | First evidence | Statement |', '| --- | --- | --- | --- | --- | --- |');
  for (const criterion of criteria) {
    const evidence = assessments.get(criterion.id)?.evidence ?? [];
    const first = evidence.length ? (typeof evidence[0] === 'string' ? evidence[0] : JSON.stringify(evidence[0])) : 'none';
    lines.push(`| ${[criterion.id, criterion.outcomeId, outcomeProgress.get(criterion.outcomeId).title, statusOf(criterion), first, criterion.statement].map(markdownText).join(' | ')} |`);
  }
  lines.push('', 'Legend: grey = not-verified; amber = partially-verified; green = achieved; red = contradicted. Hexagons are slices.', '', 'Outcome progress: achieved = 1, partially-verified = 0.5, other = 0; averaged over its criteria and rounded to a whole percent (0% with no criteria).', '');
  return lines.join('\n');
}

export async function buildProgress({ recordRoot, planId, direction = 'LR' }) {
  if (direction !== 'TD' && direction !== 'LR') {
    throw new Error(`Invalid --direction ${JSON.stringify(direction)}: expected TD or LR.`);
  }
  const root = resolve(recordRoot);
  const rootStat = await stat(root).catch(error => {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  });
  if (!rootStat?.isDirectory()) throw new Error(`ORBIT record root does not exist or is not a directory: ${root}`);
  const plans = await readRecords(root, 'plans', 'plan');
  const planIds = [...new Set(plans.map(plan => plan.id))].sort();
  if (!planIds.length) throw new Error(`No Plan records found in ${join(root, 'plans')}`);
  if (planId === undefined && planIds.length > 1) {
    throw new Error(`Ambiguous Plan selection: ${planIds.join(', ')}. Use --plan <id> to select a Plan.`);
  }
  const selectedId = planId ?? planIds[0];
  const revisions = plans.filter(plan => plan.id === selectedId).sort((left, right) => right.revision - left.revision);
  if (!revisions.length) throw new Error(`Plan ${selectedId} not found in ${join(root, 'plans')}`);
  const plan = revisions[0];
  if (revisions[1]?.revision === plan.revision) {
    throw new Error(`duplicate plan record id ${plan.id} at revision ${plan.revision}`);
  }
  const reconciliations = await readRecords(root, 'reconciliations', 'reconciliation');
  const reconciliation = reconciliations.filter(record => record.planId === plan.id)
    .sort((left, right) => Date.parse(right.reconciledAt) - Date.parse(left.reconciledAt) || compareIds(left, right))[0];
  const slices = await readRecords(root, 'slices', 'slice');
  return renderProgress(plan, reconciliation, slices.filter(slice => slice.planId === plan.id), direction);
}
