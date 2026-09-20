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

export function validateReferences(records) {
  const byKind = Object.fromEntries(Object.keys(schemaFiles).map(kind => [kind, new Map()]));
  for (const record of records) {
    if (byKind[record.kind].has(record.value.id)) throw new Error(`duplicate ${record.kind} record id ${record.value.id}`);
    byKind[record.kind].set(record.value.id, record.value);
  }
  for (const reconciliation of byKind.reconciliation.values()) {
    const plan = byKind.plan.get(reconciliation.planId);
    const snapshot = byKind.snapshot.get(reconciliation.projectSnapshotId);
    if (!plan) throw new Error(`reconciliation ${reconciliation.id} references missing plan ${reconciliation.planId}`);
    if (!snapshot) throw new Error(`reconciliation ${reconciliation.id} references missing project snapshot ${reconciliation.projectSnapshotId}`);
    if (reconciliation.planRevision !== plan.revision) throw new Error(`reconciliation ${reconciliation.id} does not reference the plan revision`);
  }
  for (const slice of byKind.slice.values()) {
    const plan = byKind.plan.get(slice.planId);
    const reconciliation = byKind.reconciliation.get(slice.basedOn.reconciliationId);
    if (!plan) throw new Error(`execution slice ${slice.id} references missing plan ${slice.planId}`);
    if (!reconciliation) throw new Error(`execution slice ${slice.id} references missing reconciliation ${slice.basedOn.reconciliationId}`);
    if (slice.basedOn.planRevision !== plan.revision) throw new Error(`execution slice ${slice.id} does not reference the plan revision`);
  }
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
