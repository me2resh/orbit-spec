#!/usr/bin/env node
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { validateFile, validateRecordRoot, validateRepository } from '../lib/validator.mjs';
import { buildReconciliation, buildSlice, captureProjectSnapshot, readJson, snapshotRepositoryCommits, writeJson } from '../lib/lifecycle.mjs';
import { syncGitHub } from '../lib/github-sync.mjs';
import { buildProgress } from '../lib/progress.mjs';
import { buildStatus, renderStatus } from '../lib/status.mjs';

const [command = 'validate', ...args] = process.argv.slice(2);

function flags(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith('--')) continue;
    const key = value.slice(2);
    const next = values[index + 1];
    result[key] = !next || next.startsWith('--') ? true : values[++index];
  }
  return result;
}

function hasTextOption(options, key) {
  return typeof options[key] === 'string' && options[key].length > 0;
}

function optionValues(values, key) {
  const matches = [];
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] !== `--${key}`) continue;
    const next = values[index + 1];
    matches.push(!next || next.startsWith('--') ? true : next);
  }
  return matches;
}

function wantsAll(values) {
  return values.length === 0 || values.includes('--all') || Boolean(flags(values).root);
}

// Best-effort scan of JSON records in the given directories. A file that is
// not an ORBIT record (a commented tsconfig.json, a file holding null) must
// not stop the command.
async function scanRecords(directories) {
  const records = [];
  for (const path of new Set(directories)) {
    let files;
    try {
      files = await readdir(path);
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') continue;
      throw error;
    }
    for (const file of files.filter(file => file.endsWith('.json')).sort()) {
      try {
        const record = await readJson(join(path, file));
        if (record && typeof record === 'object') records.push({ file: join(path, file), record });
      } catch {
        // Not readable as JSON; it cannot hold an ORBIT record.
      }
    }
  }
  return records;
}

// Fallback ID: <prefix>-<UTC timestamp>. The scan below makes the ID unique
// among nearby records; a same-second clash gets a deterministic numeric
// suffix. Both cases print a notice so the operator is never surprised.
async function defaultId(prefix, directory, options, sources = []) {
  const base = `${prefix}-${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}`;
  const directories = [
    resolve(directory), resolve('orbit', directory),
    ...sources.flatMap(file => [dirname(resolve(file)), resolve(dirname(file), '..', directory)]),
    ...(options.output ? [dirname(resolve(options.output))] : [])
  ];
  const ids = new Set((await scanRecords(directories)).map(({ record }) => record.id).filter(id => typeof id === 'string'));
  let id = base;
  for (let suffix = 2; ids.has(id); suffix += 1) id = `${base}-${suffix}`;
  const clash = id === base ? '' : ` because ${base} already exists`;
  console.error(`ORBIT notice: no --id given; using timestamp ID ${id}${clash}. Pass --id <slug> to name the record.`);
  return id;
}

// Resolve the Project Snapshot that a Reconciliation names. An explicit
// --snapshot file wins; otherwise search snapshots/ under --root, next to the
// Reconciliation's record directory, and under the working directory.
async function resolveSliceSnapshot(reconciliation, options) {
  const snapshotId = reconciliation.projectSnapshotId;
  if (hasTextOption(options, 'snapshot')) {
    await validateFile(resolve(options.snapshot), 'snapshot');
    const snapshot = await readJson(resolve(options.snapshot));
    if (snapshot.id !== snapshotId) {
      throw new Error(`--snapshot ${options.snapshot} holds ${snapshot.id}, but the Reconciliation names Project Snapshot ${snapshotId}.`);
    }
    return snapshot;
  }
  const reconciliationDirectory = dirname(resolve(options.reconciliation));
  const directories = [
    ...(hasTextOption(options, 'root') ? [resolve(options.root, 'snapshots')] : []),
    resolve(reconciliationDirectory, '..', 'snapshots'), reconciliationDirectory,
    resolve('snapshots'), resolve('orbit', 'snapshots')
  ];
  const match = (await scanRecords(directories))
    .find(({ record }) => record.id === snapshotId && Array.isArray(record.repositories));
  if (!match) return undefined;
  await validateFile(match.file, 'snapshot');
  return match.record;
}

async function sliceRepositories(reconciliation, options, repositoryIds) {
  if (repositoryIds.some(value => typeof value !== 'string')) {
    throw new Error('Usage: orbit slice ... --repository <id> requires a repository ID.');
  }
  const snapshot = await resolveSliceSnapshot(reconciliation, options);
  if (!snapshot) {
    if (repositoryIds.length > 0) throw new Error(`Project Snapshot ${reconciliation.projectSnapshotId} was not found; pass --snapshot <file> or --root <directory>.`);
    console.error(`ORBIT notice: Project Snapshot ${reconciliation.projectSnapshotId} was not found; basedOn.repositories is empty. Pass --snapshot <file> or --root <directory>.`);
    return {};
  }
  return snapshotRepositoryCommits(snapshot, repositoryIds);
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
    if (wantsAll(args)) {
      const options = flags(args);
      if (options.root === undefined && args.includes('--root')) {
        throw new Error('Usage: orbit validate --all --root <directory>');
      }
      const records = options.root
        ? await validateRecordRoot(resolve(options.root))
        : await validateRepository();
      console.log(`Validated ${records.length} ORBIT records.`);
    } else {
      for (const file of args) {
        if (file.startsWith('--')) continue;
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
      const repositoryIds = optionValues(args, 'repository');
      const repositoryPaths = optionValues(args, 'path');
      const hasInvalidOptions = ['id', 'output'].some(key => options[key] !== undefined && !hasTextOption(options, key));
      const hasInvalidRepositories = repositoryIds.length === 0
        || repositoryIds.length !== repositoryPaths.length
        || [...repositoryIds, ...repositoryPaths].some(value => typeof value !== 'string');
      if (!hasTextOption(options, 'project') || hasInvalidOptions || hasInvalidRepositories) {
        throw new Error('Usage: orbit snapshot --project <id> --repository <id> --path <git-repo> [--repository <id> --path <git-repo> ...] [--id <id>] [--output <file>]');
      }
      const repositories = repositoryIds.map((repositoryId, index) => ({
        repositoryId,
        repositoryPath: resolve(repositoryPaths[index])
      }));
      const record = await captureProjectSnapshot({ projectId: options.project, repositories, id: options.id ?? await defaultId(`snapshot-${options.project}`, 'snapshots', options) });
      await outputRecord(record, options.output, 'snapshot');
    } else if (command === 'reconcile') {
      const options = flags(args);
      if (!options.plan || !options.snapshot) throw new Error('Usage: orbit reconcile --plan <file> --snapshot <file> [--id <id>] [--output <file>]');
      const plan = await readJson(resolve(options.plan));
      const snapshot = await readJson(resolve(options.snapshot));
      await validateFile(resolve(options.plan), 'plan');
      await validateFile(resolve(options.snapshot), 'snapshot');
      const record = buildReconciliation(plan, snapshot, { id: options.id ?? await defaultId(`reconciliation-${plan.id}`, 'reconciliations', options, [options.plan, options.snapshot]) });
      await outputRecord(record, options.output, 'reconciliation');
    } else if (command === 'slice') {
      const options = flags(args);
      if (!options.plan || !options.reconciliation || !options.outcome || !options.objective || !options.why) throw new Error('Usage: orbit slice --plan <file> --reconciliation <file> --outcome <id> --objective <text> --why <text> [--id <slug>] [--snapshot <file> | --root <directory>] [--repository <id> ...] [--output <file>]');
      const plan = await readJson(resolve(options.plan));
      const reconciliation = await readJson(resolve(options.reconciliation));
      await validateFile(resolve(options.plan), 'plan');
      await validateFile(resolve(options.reconciliation), 'reconciliation');
      const repositories = await sliceRepositories(reconciliation, options, optionValues(args, 'repository'));
      const record = buildSlice(plan, reconciliation, { id: options.id ?? await defaultId(`slice-${plan.id}`, 'slices', options, [options.plan, options.reconciliation]), repositories, outcomeId: options.outcome, objective: options.objective, why: options.why, contributesTo: options.contributes ? options.contributes.split(',') : [], include: options.include ? options.include.split(',') : [], exclude: options.exclude ? options.exclude.split(',') : [] });
      await outputRecord(record, options.output, 'slice');
    } else {
      throw new Error(`Usage: orbit ${command} <record.json>`);
    }
  } else if (command === 'progress') {
    const options = flags(args);
    const hasInvalidOption = !hasTextOption(options, 'root')
      || ['plan', 'output', 'direction'].some(key => options[key] !== undefined && !hasTextOption(options, key));
    if (hasInvalidOption) {
      throw new Error('Usage: orbit progress --root <directory> [--plan <id>] [--output <file>] [--direction TD|LR]');
    }
    const markdown = await buildProgress({ recordRoot: resolve(options.root), planId: options.plan, direction: options.direction });
    if (options.output) {
      const output = resolve(options.output);
      await mkdir(dirname(output), { recursive: true });
      await writeFile(output, markdown);
      console.log(`Wrote progress report to ${options.output}.`);
    } else {
      process.stdout.write(markdown);
    }
  } else if (command === 'status') {
    const options = flags(args);
    const repositoryIds = optionValues(args, 'repository');
    const repositoryPaths = optionValues(args, 'path');
    const hasInvalidOption = !hasTextOption(options, 'root')
      || (options.plan !== undefined && !hasTextOption(options, 'plan'))
      || (options.json !== undefined && options.json !== true)
      || repositoryIds.length !== repositoryPaths.length
      || [...repositoryIds, ...repositoryPaths].some(value => typeof value !== 'string')
      || new Set(repositoryIds).size !== repositoryIds.length;
    if (hasInvalidOption) {
      throw new Error('Usage: orbit status --root <directory> [--plan <id>] [--repository <id> --path <git-repo> ...] [--json]');
    }
    const paths = Object.fromEntries(repositoryIds.map((id, index) => [id, resolve(repositoryPaths[index])]));
    const status = await buildStatus({ recordRoot: resolve(options.root), planId: options.plan, repositoryPaths: paths });
    process.stdout.write(options.json ? `${JSON.stringify(status, null, 2)}\n` : renderStatus(status));
  } else if (command === 'sync' && args[0] === 'github') {
    const options = flags(args.slice(1));
    const required = ['plan', 'snapshot', 'reconciliation', 'slice', 'repo'];
    const valued = ['issue', 'project-owner', 'project-number', 'body-prefix', 'body-prefix-file'];
    const hasInvalidOption = required.some(key => !hasTextOption(options, key))
      || valued.some(key => options[key] !== undefined && !hasTextOption(options, key))
      || ['body-prefix', 'body-prefix-file'].some(key => optionValues(args, key).length > 1)
      || (options['body-prefix'] !== undefined && options['body-prefix-file'] !== undefined)
      || (options['dry-run'] !== undefined && options['dry-run'] !== true);
    if (hasInvalidOption) {
      throw new Error('Usage: orbit sync github --plan <file> --snapshot <file> --reconciliation <file> --slice <file> --repo <owner/name> [--project-owner <owner> --project-number <number>] [--issue <number>] [--body-prefix <text> | --body-prefix-file <file>] [--dry-run]');
    }
    const plan = await readJson(resolve(options.plan));
    const snapshot = await readJson(resolve(options.snapshot));
    const slice = await readJson(resolve(options.slice));
    const reconciliation = await readJson(resolve(options.reconciliation));
    let bodyPrefix = options['body-prefix'];
    if (options['body-prefix-file'] !== undefined) {
      try {
        // Remove only the one line ending that ends a text file.
        bodyPrefix = (await readFile(resolve(options['body-prefix-file']), 'utf8')).replace(/\r?\n$/, '');
      } catch (error) {
        throw new Error(`Cannot read the body prefix file ${options['body-prefix-file']}: ${error.code ?? error.message}`);
      }
    }
    await validateFile(resolve(options.plan), 'plan');
    await validateFile(resolve(options.snapshot), 'snapshot');
    await validateFile(resolve(options.slice), 'slice');
    await validateFile(resolve(options.reconciliation), 'reconciliation');
    const result = await syncGitHub({
      plan,
      snapshot,
      reconciliation,
      slice,
      repo: options.repo,
      projectOwner: options['project-owner'],
      projectNumber: options['project-number'],
      issueNumber: options.issue,
      bodyPrefix,
      dryRun: Boolean(options['dry-run'])
    });
    console.log(JSON.stringify(result, null, 2));
  } else {
    throw new Error('Usage: orbit <validate|plan|snapshot|reconcile|slice|progress|status|sync github> [path or options]');
  }
} catch (error) {
  console.error(`ORBIT validation failed: ${error.message}`);
  process.exitCode = 1;
}
