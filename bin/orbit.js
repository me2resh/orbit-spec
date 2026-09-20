#!/usr/bin/env node
import { resolve } from 'node:path';
import { validateFile, validateRepository } from '../lib/validator.mjs';

const [command = 'validate', ...args] = process.argv.slice(2);

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
    if (args.length !== 1) throw new Error(`Usage: orbit ${command} <record.json>`);
    await validateFile(resolve(args[0]), command === 'reconcile' ? 'reconciliation' : command);
    console.log(`Validated ${command} record ${args[0]}.`);
  } else {
    throw new Error('Usage: orbit <validate|plan|snapshot|reconcile|slice> [path]');
  }
} catch (error) {
  console.error(`ORBIT validation failed: ${error.message}`);
  process.exitCode = 1;
}
