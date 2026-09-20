import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const readJson = file => JSON.parse(readFileSync(join(root, file), 'utf8'));
const schemaRoot = 'schema';
const exampleRoot = 'examples';

const schemaForExample = file => file.startsWith('plan-') ? ['Plan', 'plan.schema.json']
  : file.startsWith('project-snapshot-') ? ['ProjectSnapshot', 'project-snapshot.schema.json']
    : file.startsWith('reconciliation-') ? ['Reconciliation', 'reconciliation.schema.json']
      : file.startsWith('slice-') ? ['ExecutionSlice', 'execution-slice.schema.json'] : undefined;
const entries = readdirSync(join(root, exampleRoot)).filter(file => file.endsWith('.json')).map(exampleFile => {
  const match = schemaForExample(exampleFile);
  if (!match) throw new Error(`ORBIT example validation failed: no schema mapping for ${exampleFile}`);
  return [...match, exampleFile];
});

const fail = message => { throw new Error(`ORBIT example validation failed: ${message}`); };

function validate(value, schema, path = '$') {
  if (schema.const !== undefined && value !== schema.const) fail(`${path} must equal ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value)) fail(`${path} must be one of ${schema.enum.join(', ')}`);
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${path} must be an object`);
    for (const key of schema.required ?? []) if (!(key in value)) fail(`${path}.${key} is required`);
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) if (!schema.properties?.[key]) fail(`${path}.${key} is not in the schema`);
    }
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      if (key in value) validate(value[key], child, `${path}.${key}`);
    }
    return;
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) fail(`${path} must be an array`);
    if (schema.items) value.forEach((item, index) => validate(item, schema.items, `${path}[${index}]`));
    return;
  }
  if (schema.type === 'string') {
    if (typeof value !== 'string') fail(`${path} must be a string`);
    if (schema.minLength && value.length < schema.minLength) fail(`${path} is too short`);
    if (schema.format === 'date-time' && Number.isNaN(Date.parse(value))) fail(`${path} must be an RFC 3339 date-time`);
    return;
  }
  if (schema.type === 'integer') {
    if (!Number.isInteger(value)) fail(`${path} must be an integer`);
    if (schema.minimum !== undefined && value < schema.minimum) fail(`${path} is below the minimum`);
    return;
  }
  if (schema.type === 'number' && typeof value !== 'number') fail(`${path} must be a number`);
}

for (const [name, schemaFile, exampleFile] of entries) {
  const schema = readJson(`${schemaRoot}/${schemaFile}`);
  const value = readJson(`${exampleRoot}/${exampleFile}`);
  validate(value, schema, name);
}

const records = Object.fromEntries([
  ['Plan', 'plan-sso.json'],
  ['ProjectSnapshot', 'project-snapshot-2026-09-14.json'],
  ['Reconciliation', 'reconciliation-001.json'],
  ['ExecutionSlice', 'slice-001.json']
].map(([name, exampleFile]) => [name, readJson(`${exampleRoot}/${exampleFile}`)]));

const { Plan: plan, ProjectSnapshot: snapshot, Reconciliation: reconciliation, ExecutionSlice: slice } = records;
const repository = snapshot.repositories.find(item => item.repositoryId === 'web');
const criterion = plan.acceptanceCriteria.find(item => item.id === 'ac-1');
const evidence = reconciliation.criterionAssessments[0].evidence[0];
if (reconciliation.planId !== plan.id || reconciliation.planRevision !== plan.revision) fail('reconciliation does not reference the plan revision');
if (reconciliation.projectSnapshotId !== snapshot.id) fail('reconciliation does not reference the project snapshot');
if (slice.planId !== plan.id || slice.basedOn.planRevision !== plan.revision) fail('execution slice does not reference the plan revision');
if (slice.basedOn.reconciliationId !== reconciliation.id) fail('execution slice does not reference the reconciliation');
if (slice.outcomeId !== criterion.outcomeId || !slice.contributesTo.includes(criterion.id)) fail('execution slice is not linked to the plan criterion');
if (!repository || slice.basedOn.repositories.web !== repository.commit || evidence.repositoryId !== repository.repositoryId || evidence.commit !== repository.commit) fail('repository provenance is inconsistent');
console.log('ORBIT examples validated against schemas and cross-record references');
