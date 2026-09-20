import { readFile } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
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
  const files = readdirSync(directory).filter(file => file.endsWith('.json')).map(file => join(directory, file));
  return Promise.all(files.map(file => validateFile(file)));
}

export function validateReferences(records) {
  const byKind = Object.fromEntries(Object.keys(schemaFiles).map(kind => [kind, new Map()]));
  for (const record of records) byKind[record.kind].set(record.value.id, record.value);
  const plan = byKind.plan.get('plan-sso');
  const snapshot = byKind.snapshot.get('project-snapshot-2026-09-14');
  const reconciliation = byKind.reconciliation.get('reconciliation-001');
  const slice = byKind.slice.get('slice-001');
  if (!plan || !snapshot || !reconciliation || !slice) return;
  if (reconciliation.planId !== plan.id || reconciliation.planRevision !== plan.revision) throw new Error('reconciliation does not reference the plan revision');
  if (reconciliation.projectSnapshotId !== snapshot.id) throw new Error('reconciliation does not reference the project snapshot');
  if (slice.planId !== plan.id || slice.basedOn.planRevision !== plan.revision) throw new Error('execution slice does not reference the plan revision');
  if (slice.basedOn.reconciliationId !== reconciliation.id) throw new Error('execution slice does not reference the reconciliation');
}

export async function validateRepository() {
  const records = [...await validateDirectory(join(root, 'examples'))];
  for (const directory of ['plans', 'snapshots', 'reconciliations', 'slices']) {
    records.push(...await validateDirectory(join(root, 'orbit', directory)));
  }
  validateReferences(records);
  return records;
}
