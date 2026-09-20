#!/usr/bin/env node
import { resolve } from 'node:path';
import { validateFile, validateRepository } from '../lib/validator.mjs';
import { buildReconciliation, buildSlice, captureSnapshot, readJson, writeJson } from '../lib/lifecycle.mjs';

const [command = 'validate', ...args] = process.argv.slice(2);

function flags(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith('--')) continue;
    const key = value.slice(2);
    result[key] = values[index + 1]?.startsWith('--') ? true : values[++index];
  }
  return result;
}

async function outputRecord(record, output, kind) {
  if (output) {
    await writeJson(resolve(output), record);
    await validateFile(resolve(output), kind);
    console.log(`Wrote ${kind} record to ${output}.`);
  } else {
    console.log(JSON.stringify(record, null, 2));
  }
}

try {
  if (command === 'validate') {
    if (args.length === 0 || args[0] === '--all') {
      const records = await validateRepository();
      console.log(`Validated ${records.length} ORBIT records.`);
    } else {
      for (const file of args) {
        await validateFile(resolve(file));
        console.log(`Validated ${file}.`);
      }
    }
  } else if (['plan', 'snapshot', 'reconcile', 'slice'].includes(command)) {
    const kind = command === 'reconcile' ? 'reconciliation' : command;
    if (args.length === 1 && !args[0].startsWith('--')) {
      await validateFile(resolve(args[0]), kind);
      console.log(`Validated ${command} record ${args[0]}.`);
    } else if (command === 'plan') {
      const options = flags(args);
      if (!options.input) throw new Error('Usage: orbit plan --input <file> [--output <file>]');
      const record = await readJson(resolve(options.input));
      await validateFile(resolve(options.input), 'plan');
      await outputRecord(record, options.output, 'plan');
    } else if (command === 'snapshot') {
      const options = flags(args);
      if (!options.project || !options.repository || !options.path) throw new Error('Usage: orbit snapshot --project <id> --repository <id> --path <git-repo> [--id <id>] [--output <file>]');
      const record = await captureSnapshot({ projectId: options.project, repositoryId: options.repository, repositoryPath: resolve(options.path), id: options.id ?? `snapshot-${options.project}` });
      await outputRecord(record, options.output, 'snapshot');
    } else if (command === 'reconcile') {
      const options = flags(args);
      if (!options.plan || !options.snapshot) throw new Error('Usage: orbit reconcile --plan <file> --snapshot <file> [--id <id>] [--output <file>]');
      const plan = await readJson(resolve(options.plan));
      const snapshot = await readJson(resolve(options.snapshot));
      await validateFile(resolve(options.plan), 'plan');
      await validateFile(resolve(options.snapshot), 'snapshot');
      const record = buildReconciliation(plan, snapshot, { id: options.id ?? `reconciliation-${plan.id}` });
      await outputRecord(record, options.output, 'reconciliation');
    } else if (command === 'slice') {
      const options = flags(args);
      if (!options.plan || !options.reconciliation || !options.outcome || !options.objective || !options.why) throw new Error('Usage: orbit slice --plan <file> --reconciliation <file> --outcome <id> --objective <text> --why <text> [--id <id>] [--output <file>]');
      const plan = await readJson(resolve(options.plan));
      const reconciliation = await readJson(resolve(options.reconciliation));
      await validateFile(resolve(options.plan), 'plan');
      await validateFile(resolve(options.reconciliation), 'reconciliation');
      const record = buildSlice(plan, reconciliation, { id: options.id ?? `slice-${plan.id}`, outcomeId: options.outcome, objective: options.objective, why: options.why, contributesTo: options.contributes ? options.contributes.split(',') : [], include: options.include ? options.include.split(',') : [], exclude: options.exclude ? options.exclude.split(',') : [] });
      await outputRecord(record, options.output, 'slice');
    } else {
      throw new Error(`Usage: orbit ${command} <record.json>`);
    }
  } else {
    throw new Error('Usage: orbit <validate|plan|snapshot|reconcile|slice> [path or options]');
  }
} catch (error) {
  console.error(`ORBIT validation failed: ${error.message}`);
  process.exitCode = 1;
}
