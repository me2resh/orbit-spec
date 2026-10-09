import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const cli = resolve('bin/orbit.js');
const repository = resolve('.');
const instant = '2026-10-04T09:32:13Z';

async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), 'orbit-lifecycle-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const directory of ['plans', 'snapshots', 'reconciliations', 'slices']) {
    await mkdir(join(root, directory));
  }
  const clock = join(root, 'clock.mjs');
  await writeFile(clock, `const OriginalDate = Date;
    globalThis.Date = class extends OriginalDate {
      constructor(...args) { super(...(args.length ? args : ['${instant}'])); }
      static now() { return new OriginalDate('${instant}').getTime(); }
    };`);
  const plan = JSON.parse(await readFile(resolve('examples/plan-minimal.json'), 'utf8'));
  plan.acceptanceCriteria = [{ id: 'ac-1', outcomeId: 'outcome-pending', statement: 'The feature works.' }];
  const planFile = join(root, 'plans', 'plan-test.json');
  await writeFile(planFile, JSON.stringify(plan));
  const run = args => exec(process.execPath, ['--import', clock, cli, ...args], { cwd: root });
  const create = async (kind, number, extra = []) => {
    const directory = kind === 'reconcile' ? 'reconciliations' : `${kind}s`;
    const prefix = kind === 'reconcile' ? 'reconciliation' : kind;
    const file = join(root, directory, `${prefix}-${number}.json`);
    const inputs = kind === 'snapshot'
      ? ['--project', plan.project.id, '--repository', 'app', '--path', repository]
      : kind === 'reconcile'
        ? ['--plan', planFile, '--snapshot', join(root, 'snapshots', `snapshot-${number}.json`)]
        : ['--plan', planFile, '--reconciliation', join(root, 'reconciliations', 'reconciliation-1.json'),
          '--outcome', 'outcome-pending', '--objective', 'Implement the feature', '--why', 'Evidence is missing'];
    await run([kind, ...inputs, '--output', file, ...extra]);
    return { file, record: JSON.parse(await readFile(file, 'utf8')) };
  };
  return { root, plan, run, create };
}

test('default IDs include UTC timestamps and same-second collisions get numeric suffixes for every kind', async t => {
  const { create, plan, run, root } = await setup(t);
  for (const kind of ['snapshot', 'reconcile', 'slice']) {
    const prefix = kind === 'snapshot' ? `snapshot-${plan.project.id}`
      : `${kind === 'reconcile' ? 'reconciliation' : kind}-${plan.id}`;
    for (let number = 1; number <= 3; number += 1) {
      const { record } = await create(kind, number);
      assert.equal(record.id, `${prefix}-20261004T093213Z${number === 1 ? '' : `-${number}`}`);
    }
  }
  const { stdout } = await run(['validate', '--all', '--root', root]);
  assert.match(stdout, /Validated 10 ORBIT records/);
});

test('two snapshots and reconciliations validate, and a slice can retain an older reconciliation and commit', async t => {
  const { create, run, root } = await setup(t);
  const firstSnapshot = await create('snapshot', 1);
  const first = await create('reconcile', 1);
  const secondSnapshot = await create('snapshot', 2);
  secondSnapshot.record.repositories[0].commit = 'abcdef123456';
  await writeFile(secondSnapshot.file, JSON.stringify(secondSnapshot.record));
  const second = await create('reconcile', 2);
  // Timestamp order wins even when the older record sorts first by ID.
  first.record.id = 'reconciliation-a-old';
  first.record.reconciledAt = '2026-10-04T09:00:00Z';
  await writeFile(first.file, JSON.stringify(first.record));
  const slice = await create('slice', 1);
  slice.record.basedOn.repositories = { app: firstSnapshot.record.repositories[0].commit };
  await writeFile(slice.file, JSON.stringify(slice.record));
  const { stdout } = await run(['validate', '--all', '--root', root]);
  assert.match(stdout, /Validated 6 ORBIT records/);
  const progress = await run(['progress', '--root', root]);
  assert.ok(progress.stdout.includes(`Reconciliation: ${second.record.id} (${instant.replace('Z', '.000Z')})`));

  first.record.reconciledAt = second.record.reconciledAt;
  await writeFile(first.file, JSON.stringify(first.record));
  const tied = await run(['progress', '--root', root]);
  assert.match(tied.stdout, /Reconciliation: reconciliation-a-old/);
});

test('explicit IDs including legacy fixed defaults are preserved and validate', async t => {
  const { create, plan, run, root } = await setup(t);
  const expected = [`snapshot-${plan.project.id}`, `reconciliation-${plan.id}`, `slice-${plan.id}`];
  for (const [index, kind] of ['snapshot', 'reconcile', 'slice'].entries()) {
    const { record } = await create(kind, 1, ['--id', expected[index]]);
    assert.equal(record.id, expected[index]);
  }
  const { stdout } = await run(['validate', '--all', '--root', root]);
  assert.match(stdout, /Validated 4 ORBIT records/);
});

test('default IDs check records near inputs when output is printed to stdout', async t => {
  const { create, run, root } = await setup(t);
  const snapshot = await create('snapshot', 1);
  const reconciliation = await create('reconcile', 1);
  const { stdout } = await run(['reconcile', '--plan', join(root, 'plans', 'plan-test.json'), '--snapshot', snapshot.file]);
  assert.equal(JSON.parse(stdout).id, `${reconciliation.record.id}-2`);
});
