import { readFile } from 'node:fs/promises';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const schemaDir = join(root, 'schema');
const schemaFiles = {
  plan: 'plan.schema.json',
  snapshot: 'project-snapshot.schema.json',
  reconciliation: 'reconciliation.schema.json',
  slice: 'execution-slice.schema.json'
};
export const RECORD_DIRECTORIES = ['plans', 'snapshots', 'reconciliations', 'slices'];

const ajv = new Ajv({ allErrors: true, strict: true });
addFormats(ajv);
const schemas = {};
for (const [kind, file] of Object.entries(schemaFiles)) {
  const schema = JSON.parse(await readFile(join(schemaDir, file), 'utf8'));
  schemas[kind] = ajv.compile(schema);
}

export function inferKind(file) {
  const name = basename(file, extname(file));
  if (name.startsWith('plan-')) return 'plan';
  if (name.startsWith('project-snapshot-') || name.startsWith('snapshot-')) return 'snapshot';
  if (name.startsWith('reconciliation-')) return 'reconciliation';
  if (name.startsWith('slice-')) return 'slice';
  return undefined;
}

export async function validateFile(file, kind = inferKind(file)) {
  if (!kind || !schemas[kind]) throw new Error(`Cannot infer an ORBIT record type from ${file}`);
  const value = JSON.parse(await readFile(file, 'utf8'));
  const valid = schemas[kind](value);
  if (!valid) throw new Error(`${file}\n${ajv.errorsText(schemas[kind].errors, { separator: '\n' })}`);
  return { file, kind, value };
}

export async function validateDirectory(directory) {
  if (!existsSync(directory)) return [];
  const files = readdirSync(directory).filter(file => file.endsWith('.json')).map(file => join(directory, file));
  return Promise.all(files.map(file => validateFile(file)));
}

function uniqueById(values, label, ownerId, key = 'id') {
  const result = new Map();
  for (const value of values ?? []) {
    const id = value[key];
    if (result.has(id)) throw new Error(`${ownerId} has duplicate ${label} id ${id}`);
    result.set(id, value);
  }
  return result;
}

function snapshotRepositories(snapshot) {
  return uniqueById(snapshot.repositories ?? [], 'repository', `project snapshot ${snapshot.id}`, 'repositoryId');
}

function validateEvidence(evidence, repositories, ownerId) {
  for (const item of evidence ?? []) {
    if (!item || typeof item !== 'object' || !item.repositoryId) continue;
    const repository = repositories.get(item.repositoryId);
    if (!repository) throw new Error(`${ownerId} references repository ${item.repositoryId} outside its project snapshot`);
    if (item.commit !== undefined && item.commit !== repository.commit) {
      throw new Error(`${ownerId} references a stale commit for repository ${item.repositoryId}`);
    }
  }
}

export const HISTORY_DIRECTORY = 'history';

function planKey(id, revision) {
  return JSON.stringify([id, revision]);
}

function indexRecords(records) {
  const byKind = Object.fromEntries(Object.keys(schemaFiles).map(kind => [kind, new Map()]));
  const currentRevisions = new Map();
  for (const record of records) {
    const { id } = record.value;
    const key = record.kind === 'plan' ? planKey(id, record.value.revision) : id;
    if (byKind[record.kind].has(key)) {
      const at = record.kind === 'plan' ? ` at revision ${record.value.revision}` : '';
      throw new Error(`duplicate ${record.kind} record id ${id}${at}`);
    }
    byKind[record.kind].set(key, { value: record.value, history: record.history === true });
    if (record.kind === 'plan' && record.history !== true) {
      if (currentRevisions.has(id)) {
        throw new Error(`plan ${id} has more than one current revision (${currentRevisions.get(id)} and ${record.value.revision}); move superseded revisions to ${HISTORY_DIRECTORY}/plans/`);
      }
      currentRevisions.set(id, record.value.revision);
    }
  }
  return byKind;
}

function values(map) {
  return [...map.values()].map(entry => entry.value);
}

function resolvePlan(byKind, planId, revision) {
  const entry = byKind.plan.get(planKey(planId, revision));
  if (entry) return { entry };
  const known = [...byKind.plan.values()].some(candidate => candidate.value.id === planId);
  return { known };
}

function requireCurrent(owner, entry, description) {
  if (!owner.history && entry.history) {
    throw new Error(`${description} is a ${HISTORY_DIRECTORY} record; only basedOn provenance may reference ${HISTORY_DIRECTORY} records`);
  }
}

export function validateReferences(records) {
  const byKind = indexRecords(records);
  for (const plan of values(byKind.plan)) {
    const outcomes = uniqueById(plan.outcomes, 'outcome', `plan ${plan.id}`);
    const criteria = uniqueById(plan.acceptanceCriteria, 'acceptance criterion', `plan ${plan.id}`);
    for (const criterion of criteria.values()) {
      if (!outcomes.has(criterion.outcomeId)) {
        throw new Error(`plan ${plan.id} acceptance criterion ${criterion.id} references missing outcome ${criterion.outcomeId}`);
      }
    }
  }
  for (const snapshot of values(byKind.snapshot)) snapshotRepositories(snapshot);
  for (const owner of byKind.reconciliation.values()) {
    const reconciliation = owner.value;
    const planMatch = resolvePlan(byKind, reconciliation.planId, reconciliation.planRevision);
    const snapshotEntry = byKind.snapshot.get(reconciliation.projectSnapshotId);
    if (!planMatch.entry && !planMatch.known) throw new Error(`reconciliation ${reconciliation.id} references missing plan ${reconciliation.planId}`);
    if (!snapshotEntry) throw new Error(`reconciliation ${reconciliation.id} references missing project snapshot ${reconciliation.projectSnapshotId}`);
    if (!planMatch.entry) throw new Error(`reconciliation ${reconciliation.id} does not reference the plan revision`);
    requireCurrent(owner, planMatch.entry, `reconciliation ${reconciliation.id} plan ${reconciliation.planId} revision ${reconciliation.planRevision}`);
    requireCurrent(owner, snapshotEntry, `reconciliation ${reconciliation.id} project snapshot ${reconciliation.projectSnapshotId}`);
    const plan = planMatch.entry.value;
    const snapshot = snapshotEntry.value;
    if (snapshot.project?.id !== plan.project?.id) {
      throw new Error(`reconciliation ${reconciliation.id} links plan project ${plan.project?.id} to snapshot project ${snapshot.project?.id}`);
    }
    const criteria = uniqueById(plan.acceptanceCriteria, 'acceptance criterion', `plan ${plan.id}`);
    const assessmentIds = new Set();
    const repositories = snapshotRepositories(snapshot);
    for (const assessment of reconciliation.criterionAssessments ?? []) {
      if (assessmentIds.has(assessment.criterionId)) {
        throw new Error(`reconciliation ${reconciliation.id} has duplicate assessment for criterion ${assessment.criterionId}`);
      }
      assessmentIds.add(assessment.criterionId);
      if (!criteria.has(assessment.criterionId)) {
        throw new Error(`reconciliation ${reconciliation.id} references unknown criterion ${assessment.criterionId}`);
      }
      validateEvidence(assessment.evidence, repositories, `reconciliation ${reconciliation.id} criterion ${assessment.criterionId}`);
    }
    if (assessmentIds.size !== criteria.size) {
      const missing = [...criteria.keys()].filter(criterionId => !assessmentIds.has(criterionId));
      throw new Error(`reconciliation ${reconciliation.id} is missing assessments for criteria ${missing.join(', ')}`);
    }
  }
  // A slice names its Plan revision and Reconciliation only through basedOn.
  // That provenance may resolve to history records: a delivered slice keeps
  // the justification it was cut from after a Plan revision supersedes it.
  for (const { value: slice } of byKind.slice.values()) {
    const planMatch = resolvePlan(byKind, slice.planId, slice.basedOn.planRevision);
    const reconciliation = byKind.reconciliation.get(slice.basedOn.reconciliationId)?.value;
    if (!planMatch.entry && !planMatch.known) throw new Error(`execution slice ${slice.id} references missing plan ${slice.planId}`);
    if (!reconciliation) throw new Error(`execution slice ${slice.id} references missing reconciliation ${slice.basedOn.reconciliationId}`);
    if (!planMatch.entry) throw new Error(`execution slice ${slice.id} does not reference the plan revision`);
    const plan = planMatch.entry.value;
    if (reconciliation.planId !== plan.id || reconciliation.planRevision !== slice.basedOn.planRevision) {
      throw new Error(`execution slice ${slice.id} references a reconciliation from another plan or revision`);
    }
    const snapshot = byKind.snapshot.get(reconciliation.projectSnapshotId)?.value;
    if (!snapshot) throw new Error(`execution slice ${slice.id} reconciliation references missing project snapshot ${reconciliation.projectSnapshotId}`);
    const outcomes = uniqueById(plan.outcomes, 'outcome', `plan ${plan.id}`);
    const criteria = uniqueById(plan.acceptanceCriteria, 'acceptance criterion', `plan ${plan.id}`);
    if (!outcomes.has(slice.outcomeId)) {
      throw new Error(`execution slice ${slice.id} references unknown outcome ${slice.outcomeId}`);
    }
    const contributedIds = new Set();
    for (const criterionId of slice.contributesTo ?? []) {
      if (contributedIds.has(criterionId)) {
        throw new Error(`execution slice ${slice.id} repeats contributed criterion ${criterionId}`);
      }
      contributedIds.add(criterionId);
      const criterion = criteria.get(criterionId);
      if (!criterion) throw new Error(`execution slice ${slice.id} references unknown criterion ${criterionId}`);
      if (criterion.outcomeId !== slice.outcomeId) {
        throw new Error(`execution slice ${slice.id} criterion ${criterionId} belongs to outcome ${criterion.outcomeId}`);
      }
    }
    const repositories = snapshotRepositories(snapshot);
    for (const [repositoryId, commit] of Object.entries(slice.basedOn.repositories ?? {})) {
      const repository = repositories.get(repositoryId);
      if (!repository) throw new Error(`execution slice ${slice.id} references repository ${repositoryId} outside its project snapshot`);
      if (repository.commit !== commit) {
        throw new Error(`execution slice ${slice.id} references a stale commit for repository ${repositoryId}`);
      }
    }
  }
}

export function validateRecordChain({ plan, snapshot, reconciliation, slice }) {
  if (!plan || !snapshot || !reconciliation || !slice) {
    throw new Error('a record chain requires a Plan, Project Snapshot, Reconciliation, and Execution Slice');
  }
  validateReferences([
    { kind: 'plan', value: plan },
    { kind: 'snapshot', value: snapshot },
    { kind: 'reconciliation', value: reconciliation },
    { kind: 'slice', value: slice }
  ]);
}

export async function validateRecordRoot(recordRoot) {
  const resolvedRoot = resolve(recordRoot);
  if (!existsSync(resolvedRoot) || !statSync(resolvedRoot).isDirectory()) {
    throw new Error(`ORBIT record root does not exist or is not a directory: ${resolvedRoot}`);
  }
  const records = [];
  for (const directory of RECORD_DIRECTORIES) {
    records.push(...await validateDirectory(join(resolvedRoot, directory)));
  }
  // history/ holds superseded records. They are schema-validated and resolve
  // references, but they are never current.
  for (const directory of RECORD_DIRECTORIES) {
    const history = await validateDirectory(join(resolvedRoot, HISTORY_DIRECTORY, directory));
    records.push(...history.map(record => ({ ...record, history: true })));
  }
  validateReferences(records);
  return records;
}

export async function validateRepository() {
  const examples = await validateDirectory(join(root, 'examples'));
  validateReferences(examples);
  const orbit = await validateRecordRoot(join(root, 'orbit'));
  return [...examples, ...orbit];
}
