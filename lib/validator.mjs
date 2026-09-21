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

export function validateReferences(records) {
  const byKind = Object.fromEntries(Object.keys(schemaFiles).map(kind => [kind, new Map()]));
  for (const record of records) {
    if (byKind[record.kind].has(record.value.id)) throw new Error(`duplicate ${record.kind} record id ${record.value.id}`);
    byKind[record.kind].set(record.value.id, record.value);
  }
  for (const plan of byKind.plan.values()) {
    const outcomes = uniqueById(plan.outcomes, 'outcome', `plan ${plan.id}`);
    const criteria = uniqueById(plan.acceptanceCriteria, 'acceptance criterion', `plan ${plan.id}`);
    for (const criterion of criteria.values()) {
      if (!outcomes.has(criterion.outcomeId)) {
        throw new Error(`plan ${plan.id} acceptance criterion ${criterion.id} references missing outcome ${criterion.outcomeId}`);
      }
    }
  }
  for (const snapshot of byKind.snapshot.values()) snapshotRepositories(snapshot);
  for (const reconciliation of byKind.reconciliation.values()) {
    const plan = byKind.plan.get(reconciliation.planId);
    const snapshot = byKind.snapshot.get(reconciliation.projectSnapshotId);
    if (!plan) throw new Error(`reconciliation ${reconciliation.id} references missing plan ${reconciliation.planId}`);
    if (!snapshot) throw new Error(`reconciliation ${reconciliation.id} references missing project snapshot ${reconciliation.projectSnapshotId}`);
    if (reconciliation.planRevision !== plan.revision) throw new Error(`reconciliation ${reconciliation.id} does not reference the plan revision`);
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
  for (const slice of byKind.slice.values()) {
    const plan = byKind.plan.get(slice.planId);
    const reconciliation = byKind.reconciliation.get(slice.basedOn.reconciliationId);
    if (!plan) throw new Error(`execution slice ${slice.id} references missing plan ${slice.planId}`);
    if (!reconciliation) throw new Error(`execution slice ${slice.id} references missing reconciliation ${slice.basedOn.reconciliationId}`);
    if (slice.basedOn.planRevision !== plan.revision) throw new Error(`execution slice ${slice.id} does not reference the plan revision`);
    if (reconciliation.planId !== plan.id || reconciliation.planRevision !== slice.basedOn.planRevision) {
      throw new Error(`execution slice ${slice.id} references a reconciliation from another plan or revision`);
    }
    const snapshot = byKind.snapshot.get(reconciliation.projectSnapshotId);
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
  validateReferences(records);
  return records;
}

export async function validateRepository() {
  const examples = await validateDirectory(join(root, 'examples'));
  validateReferences(examples);
  const orbit = await validateRecordRoot(join(root, 'orbit'));
  return [...examples, ...orbit];
}
