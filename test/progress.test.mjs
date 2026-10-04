import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['bin/orbit.js', 'progress', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('close', code => resolve({ code, stdout, stderr }));
    child.on('error', reject);
  });
}

function graphOf(markdown) {
  return markdown.split('```mermaid\n')[1].split('\n```')[0];
}

const plan = {
  specVersion: '0.1',
  id: 'plan-progress',
  revision: 2,
  project: { id: 'example-project' },
  title: 'Delivery progress',
  intent: 'Deliver a bounded change.',
  outcomes: [
    { id: 'outcome-empty', title: 'Unscoped work' },
    { id: 'outcome-delivery', title: 'Delivery' }
  ],
  acceptanceCriteria: [
    { id: 'ac2-1', outcomeId: 'outcome-delivery', statement: 'The feature works.' },
    { id: 'ac-4', outcomeId: 'outcome-delivery', statement: 'No regressions occur.' },
    { id: 'ac-3', outcomeId: 'outcome-delivery', statement: 'The documentation is current.' },
    { id: 'ac-1', outcomeId: 'outcome-delivery', statement: 'The tests pass.' }
  ]
};

const reconciliation = {
  specVersion: '0.1',
  id: 'reconciliation-progress',
  planId: plan.id,
  planRevision: 2,
  projectSnapshotId: 'snapshot-progress',
  reconciledAt: '2026-09-15T16:05:00Z',
  observations: [],
  criterionAssessments: [
    { criterionId: 'ac2-1', status: 'partially-verified', evidence: [{ path: 'src/feature.js', passed: false }, 'Second evidence'] },
    { criterionId: 'ac-4', status: 'contradicted', evidence: ['Regression test failed.'] },
    { criterionId: 'ac-3', status: 'not-verified', evidence: [] },
    { criterionId: 'ac-1', status: 'achieved', evidence: ['Tests passed.'] }
  ]
};

const slice = {
  specVersion: '0.1',
  id: 'slice-1',
  planId: plan.id,
  outcomeId: 'outcome-delivery',
  basedOn: { planRevision: 1, reconciliationId: 'reconciliation-earlier', repositories: {} },
  objective: 'Finish the feature.',
  why: 'Implementation is incomplete.',
  contributesTo: ['ac2-1', 'ac-1'],
  scope: { include: [], exclude: [] }
};

function writeProjectRoot(t, overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'orbit-progress-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const records = {
    plans: overrides.plans ?? [plan],
    reconciliations: overrides.reconciliations ?? [reconciliation],
    slices: overrides.slices ?? [slice]
  };
  for (const [directory, values] of Object.entries(records)) {
    mkdirSync(join(root, directory));
    for (const [index, value] of values.entries()) {
      // Kind comes from the directory, not from the filename.
      writeFileSync(join(root, directory, `${index}.json`), `${JSON.stringify(value, null, 2)}\n`);
    }
  }
  return root;
}

test('progress colours criteria by status and includes full statements and first evidence', async t => {
  const root = writeProjectRoot(t);
  const result = await run(['--root', root]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^# Delivery progress \(revision 2\)\n/);
  assert.match(result.stdout, /Reconciliation: reconciliation-progress \(2026-09-15T16:05:00Z\)/);
  assert.equal(graphOf(result.stdout), `graph LR
  plan_plan_progress["plan-progress (revision 2)"]
  outcome_outcome_delivery["outcome-delivery · 38% (1 of 4 achieved, 1 partly)"]
  plan_plan_progress --> outcome_outcome_delivery
  outcome_outcome_empty["outcome-empty · 0% (0 of 0 achieved, 0 partly)"]
  plan_plan_progress --> outcome_outcome_empty
  criterion_ac_1["ac-1: The tests pass."]
  outcome_outcome_delivery --> criterion_ac_1
  class criterion_ac_1 achieved;
  criterion_ac_3["ac-3: The documentation is current."]
  outcome_outcome_delivery --> criterion_ac_3
  class criterion_ac_3 not_verified;
  criterion_ac_4["ac-4: No regressions occur."]
  outcome_outcome_delivery --> criterion_ac_4
  class criterion_ac_4 contradicted;
  criterion_ac2_1["ac2-1: The feature works."]
  outcome_outcome_delivery --> criterion_ac2_1
  class criterion_ac2_1 partially_verified;
  slice_slice_1{{"slice-1"}}
  slice_slice_1 --> criterion_ac_1
  slice_slice_1 --> criterion_ac2_1
  classDef not_verified fill:#e5e7eb,stroke:#4b5563,color:#111827;
  classDef partially_verified fill:#fde68a,stroke:#92400e,color:#111827;
  classDef achieved fill:#bbf7d0,stroke:#166534,color:#111827;
  classDef contradicted fill:#fecaca,stroke:#991b1b,color:#111827;`);
  for (const [id, status, fill] of [
    ['ac_3', 'not_verified', '#e5e7eb'],
    ['ac2_1', 'partially_verified', '#fde68a'],
    ['ac_1', 'achieved', '#bbf7d0'],
    ['ac_4', 'contradicted', '#fecaca']
  ]) {
    assert.ok(result.stdout.includes(`class criterion_${id} ${status};`));
    assert.match(result.stdout, new RegExp(`classDef ${status} fill:${fill},stroke:#[a-f0-9]+,color:#111827;`));
  }
  assert.ok(result.stdout.includes('| ac2-1 | outcome-delivery | Delivery | partially-verified | {"path":"src/feature.js","passed":false} | The feature works. |'));
  assert.ok(result.stdout.includes('| ac-3 | outcome-delivery | Delivery | not-verified | none | The documentation is current. |'));
  assert.doesNotMatch(result.stdout, /Second evidence/);
  assert.match(result.stdout, /Legend:/);
});

test('progress shares counts and rounded percentages between outcome nodes and the Outcomes table', async t => {
  const root = writeProjectRoot(t);
  const result = await run(['--root', root]);
  assert.equal(result.code, 0, result.stderr);
  // (1 + 0.5 + 0 + 0) / 4 = 37.5%, rounded to 38%.
  assert.ok(result.stdout.includes('outcome_outcome_delivery["outcome-delivery · 38% (1 of 4 achieved, 1 partly)"]'));
  assert.ok(result.stdout.includes('outcome_outcome_empty["outcome-empty · 0% (0 of 0 achieved, 0 partly)"]'));
  assert.ok(result.stdout.includes('## Outcomes\n\n| ID | Title | Percent | Achieved | Partly | Total |\n| --- | --- | --- | --- | --- | --- |\n| outcome-delivery | Delivery | 38% | 1 | 1 | 4 |\n| outcome-empty | Unscoped work | 0% | 0 | 0 | 0 |'));
  for (const [status, percent, achieved, partial] of [['achieved', 100, 1, 0], ['partially-verified', 50, 0, 1], ['contradicted', 0, 0, 0]]) {
    const singleRoot = writeProjectRoot(t, {
      plans: [{ ...plan, acceptanceCriteria: [plan.acceptanceCriteria[0]] }],
      reconciliations: [{ ...reconciliation, criterionAssessments: [{ criterionId: 'ac2-1', status, evidence: [] }] }],
      slices: []
    });
    const single = await run(['--root', singleRoot]);
    assert.equal(single.code, 0, single.stderr);
    assert.ok(single.stdout.includes(`outcome-delivery · ${percent}% (${achieved} of 1 achieved, ${partial} partly)`));
    assert.ok(single.stdout.includes(`| outcome-delivery | Delivery | ${percent}% | ${achieved} | ${partial} | 1 |`));
  }
});

test('progress draws every matching slice as a hexagon with sorted criterion links', async t => {
  const root = writeProjectRoot(t, {
    slices: [
      { ...slice, id: 'slice-2', contributesTo: [] },
      { ...slice, id: 'slice-other', planId: 'another-plan' },
      slice
    ]
  });
  const result = await run(['--root', root]);
  assert.equal(result.code, 0, result.stderr);
  assert.ok(result.stdout.includes('slice_slice_1{{"slice-1"}}\n  slice_slice_1 --> criterion_ac_1\n  slice_slice_1 --> criterion_ac2_1'));
  assert.ok(result.stdout.includes('slice_slice_2{{"slice-2"}}'));
  assert.doesNotMatch(graphOf(result.stdout), /Finish the feature/);
  assert.doesNotMatch(result.stdout, /slice-other/);
  assert.ok(result.stdout.indexOf('slice_slice_1{{') < result.stdout.indexOf('slice_slice_2{{'));
});

test('progress without a reconciliation marks every criterion not-verified', async t => {
  const root = writeProjectRoot(t);
  rmSync(join(root, 'reconciliations'), { recursive: true });
  const result = await run(['--root', root]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Reconciliation: no reconciliation yet/);
  assert.equal((result.stdout.match(/class criterion_\w+ not_verified;/g) ?? []).length, 4);
  assert.equal((result.stdout.match(/\| not-verified \| none \|/g) ?? []).length, 4);
  assert.ok(result.stdout.includes('outcome-delivery · 0% (0 of 4 achieved, 0 partly)'));
  assert.ok(result.stdout.includes('| outcome-delivery | Delivery | 0% | 0 | 0 | 4 |'));
  assert.doesNotMatch(result.stdout, /2026-/);
});

test('progress accepts a plan-only root with missing optional directories', async t => {
  const root = writeProjectRoot(t, { plans: [{ ...plan, outcomes: [], acceptanceCriteria: [] }] });
  rmSync(join(root, 'reconciliations'), { recursive: true });
  rmSync(join(root, 'slices'), { recursive: true });
  const result = await run(['--root', root]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /no reconciliation yet/);
  assert.doesNotMatch(result.stdout, /NaN|undefined/);
});

test('progress selects the highest plan revision and newest reconciliation by instant', async t => {
  const root = writeProjectRoot(t, {
    plans: [
      { ...plan, revision: 1, title: 'Old title' },
      { ...plan, revision: 10, title: 'Latest title' },
      plan
    ],
    reconciliations: [
      { ...reconciliation, id: 'reconciliation-z', reconciledAt: '2026-09-16T01:00:00+02:00' },
      { ...reconciliation, id: 'reconciliation-newest', reconciledAt: '2026-09-15T23:30:00Z' },
      { ...reconciliation, id: 'reconciliation-other', planId: 'other-plan', reconciledAt: '2026-09-17T00:00:00Z' }
    ]
  });
  const result = await run(['--root', root]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^# Latest title \(revision 10\)/);
  assert.ok(graphOf(result.stdout).includes('plan_plan_progress["plan-progress (revision 10)"]'));
  assert.doesNotMatch(graphOf(result.stdout), /Latest title/);
  assert.match(result.stdout, /Reconciliation: reconciliation-newest \(2026-09-15T23:30:00Z\)/);
  assert.doesNotMatch(result.stdout, /Old title|reconciliation-z|reconciliation-other/);
});

test('progress breaks equal reconciliation timestamps by ID', async t => {
  const root = writeProjectRoot(t, {
    reconciliations: [{ ...reconciliation, id: 'z-last' }, { ...reconciliation, id: 'a-first' }]
  });
  const result = await run(['--root', root]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Reconciliation: a-first /);
});

test('progress requires --plan for an ambiguous root and selects the requested ID', async t => {
  const root = writeProjectRoot(t, { plans: [plan, { ...plan, id: 'plan-other', title: 'Other plan' }] });
  const ambiguous = await run(['--root', root]);
  assert.equal(ambiguous.code, 1);
  assert.equal(ambiguous.stdout, '');
  assert.match(ambiguous.stderr, /Ambiguous Plan selection: plan-other, plan-progress\. Use --plan <id>/);
  const selected = await run(['--root', root, '--plan', 'plan-other']);
  assert.equal(selected.code, 0, selected.stderr);
  assert.match(selected.stdout, /^# Other plan/);
  assert.match(selected.stdout, /no reconciliation yet/);
  assert.doesNotMatch(selected.stdout, /slice_slice_1/);
  const missing = await run(['--root', root, '--plan', 'unknown']);
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /Plan unknown not found/);
});

test('progress validates all loaded records before producing output', async t => {
  const cases = [
    { plans: [plan, { ...plan, revision: 'old' }], field: 'revision' },
    { reconciliations: [reconciliation, { ...reconciliation, reconciledAt: 'yesterday' }], field: 'reconciledAt' },
    { reconciliations: [{ ...reconciliation, criterionAssessments: [{ criterionId: 'ac-1', status: 'done', evidence: [] }] }], field: 'status' },
    { slices: [slice, { ...slice, contributesTo: false }], field: 'contributesTo' }
  ];
  for (const { field, ...overrides } of cases) {
    const root = writeProjectRoot(t, overrides);
    const output = join(root, 'progress.md');
    writeFileSync(output, 'Existing report\n');
    const result = await run(['--root', root, '--output', output]);
    assert.equal(result.code, 1, field);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /ORBIT validation failed: Invalid .* record .*\.json/);
    assert.ok(result.stderr.includes(field), result.stderr);
    assert.equal(readFileSync(output, 'utf8'), 'Existing report\n');
  }
});

test('progress reports the path of malformed JSON', async t => {
  const root = writeProjectRoot(t);
  writeFileSync(join(root, 'slices', 'broken.json'), '{');
  const result = await run(['--root', root]);
  assert.equal(result.code, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /Invalid slice record .*broken\.json/);
});

test('progress escapes graph labels and Markdown cells while retaining full statements', async t => {
  const unsafe = '"q" [b] <t> & | `c` \\ {x} (y) #35;';
  const statement = `${unsafe}\n${'Long statement. '.repeat(12)}TAIL`;
  const root = writeProjectRoot(t, {
    plans: [{
      ...plan,
      title: unsafe,
      outcomes: [{ id: 'outcome-delivery', title: unsafe }],
      acceptanceCriteria: [{ id: 'ac2-1', outcomeId: 'outcome-delivery', statement }]
    }],
    reconciliations: [{ ...reconciliation, criterionAssessments: [{ criterionId: 'ac2-1', status: 'achieved', evidence: ['a|b\n<script>'] }] }],
    slices: [{ ...slice, objective: unsafe, contributesTo: ['ac2-1'] }]
  });
  const result = await run(['--root', root]);
  assert.equal(result.code, 0, result.stderr);
  const graph = graphOf(result.stdout);
  assert.ok(graph.includes('#34;q#34; #91;b#93; #60;t#62; #38; #124; #96;c#96; #92; #123;x#125; #40;y#41; #35;35#59;'));
  assert.match(graph, /criterion_ac2_1\[".*…"\]/);
  assert.doesNotMatch(graph, /<t>|`c`|TAIL|undefined/);
  assert.ok(result.stdout.includes('a&#124;b<br>&#60;script&#62;'));
  assert.ok(result.stdout.includes('Long statement. '.repeat(12) + 'TAIL |'));
  assert.ok(result.stdout.includes('| outcome-delivery | "q" &#91;b&#93; &#60;t&#62; &#38; &#124; &#96;c&#96; &#92; {x} (y) #35; | 100% | 1 | 0 | 1 |'));
});

test('progress truncates only statements at 45 characters, using word boundaries and Unicode characters', async t => {
  const atLimit = `${'word '.repeat(8)}final`;
  const cases = [
    ['Short statement.', 'Short statement.'],
    [atLimit, atLimit],
    [`${atLimit} extra`, `${atLimit}…`],
    [`${atLimit}s`, `${'word '.repeat(8).trimEnd()}…`],
    [`${'word '.repeat(9)}extra`, `${'word '.repeat(9).trimEnd()}…`],
    ['x'.repeat(46), `${'x'.repeat(45)}…`],
    [`${'𐐀'.repeat(43)} a more`, `${'𐐀'.repeat(43)} a…`],
    ['  Whitespace\n\t is   normalized.  ', 'Whitespace is normalized.']
  ];
  for (const [statement, expected] of cases) {
    const id = `criterion-${'long-'.repeat(16)}id`;
    const root = writeProjectRoot(t, {
      plans: [{ ...plan, acceptanceCriteria: [{ id, outcomeId: 'outcome-delivery', statement }] }],
      reconciliations: [],
      slices: []
    });
    const result = await run(['--root', root]);
    assert.equal(result.code, 0, result.stderr);
    assert.ok(graphOf(result.stdout).includes(`["${id}: ${expected}"]`), statement);
    assert.ok(result.stdout.includes(`| ${statement.replace(/\n/g, '<br>')} |`), statement);
  }
});

test('progress accepts explicit TD and LR directions without changing report content', async t => {
  const root = writeProjectRoot(t);
  const defaultResult = await run(['--root', root]);
  assert.equal(defaultResult.code, 0, defaultResult.stderr);
  for (const direction of ['TD', 'LR']) {
    const result = await run(['--root', root, '--direction', direction]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, defaultResult.stdout.replace('graph LR\n', `graph ${direction}\n`));
  }
});

test('progress rejects invalid directions before writing any output', async t => {
  const root = writeProjectRoot(t);
  const output = join(root, 'progress.md');
  writeFileSync(output, 'Existing report\n');
  for (const direction of ['TB', 'RL', 'td', 'lr', 'invalid', 'LR\nInjected graph']) {
    const result = await run(['--root', root, '--direction', direction, '--output', output]);
    assert.equal(result.code, 1);
    assert.equal(result.stdout, '');
    assert.ok(result.stderr.includes(`Invalid --direction ${JSON.stringify(direction)}: expected TD or LR.`));
    assert.equal(readFileSync(output, 'utf8'), 'Existing report\n');
  }
});

test('progress uses valid, distinct node IDs even when sanitization collides', async t => {
  const ids = ['ac2_1_2', 'ac2_1', 'ac2-1', '0"[bad]', 'end'];
  const root = writeProjectRoot(t, {
    plans: [{
      ...plan,
      id: 'end',
      outcomes: [{ id: 'end', title: 'Result' }],
      acceptanceCriteria: ids.map(id => ({ id, outcomeId: 'end', statement: 'A criterion.' }))
    }],
    reconciliations: [],
    slices: [{ ...slice, planId: 'end', id: 'end', outcomeId: 'end', contributesTo: ids }]
  });
  const result = await run(['--root', root]);
  assert.equal(result.code, 0, result.stderr);
  const graph = result.stdout.split('```mermaid\n')[1].split('\n```')[0];
  const nodes = [...graph.matchAll(/^  ([a-zA-Z_][a-zA-Z0-9_]*)(?:\[|\{\{)"/gm)].map(match => match[1]);
  assert.equal(nodes.length, 8);
  assert.equal(new Set(nodes).size, nodes.length);
  for (const [, from, to] of graph.matchAll(/^  (\w+) --> (\w+)$/gm)) {
    assert.ok(nodes.includes(from), from);
    assert.ok(nodes.includes(to), to);
  }
  const targets = [...graph.matchAll(/^  slice_end --> (\w+)$/gm)].map(match => match[1]);
  assert.equal(new Set(targets).size, ids.length);
});

test('progress is byte-identical across runs and sorts records and links by ID', async t => {
  const root = writeProjectRoot(t);
  const first = await run(['--root', root]);
  const second = await run(['--root', root]);
  assert.equal(first.code, 0, first.stderr);
  assert.equal(second.code, 0, second.stderr);
  assert.equal(first.stdout, second.stdout);
  const reorderedRoot = writeProjectRoot(t, {
    plans: [{ ...plan, outcomes: [...plan.outcomes].reverse(), acceptanceCriteria: [...plan.acceptanceCriteria].reverse() }],
    reconciliations: [{ ...reconciliation, criterionAssessments: [...reconciliation.criterionAssessments].reverse() }],
    slices: [{ ...slice, contributesTo: [...slice.contributesTo].reverse() }]
  });
  const reordered = await run(['--root', reorderedRoot]);
  assert.equal(reordered.code, 0, reordered.stderr);
  assert.equal(reordered.stdout, first.stdout);
  const tableIds = [...first.stdout.matchAll(/^\| (ac[^ ]+) \|/gm)].map(match => match[1]);
  assert.deepEqual(tableIds, ['ac-1', 'ac-3', 'ac-4', 'ac2-1']);
});

test('progress --output writes the same Markdown and creates parent directories', async t => {
  const root = writeProjectRoot(t);
  const stdout = await run(['--root', root]);
  const output = join(root, 'reports', 'progress.md');
  const written = await run(['--root', root, '--output', output]);
  assert.equal(stdout.code, 0, stdout.stderr);
  assert.equal(written.code, 0, written.stderr);
  assert.equal(readFileSync(output, 'utf8'), stdout.stdout);
  assert.match(written.stdout, /Wrote progress report/);
});

test('progress rejects missing option values, empty roots, and nonexistent roots', async t => {
  const root = writeProjectRoot(t, { plans: [] });
  for (const args of [[], ['--root'], ['--root', root, '--plan'], ['--root', root, '--output'], ['--root', root, '--direction'], ['--root', root, '--direction', ''], ['--root', root, '--direction', '--plan', plan.id]]) {
    const result = await run(args);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Usage: orbit progress --root/);
  }
  const empty = await run(['--root', root]);
  assert.equal(empty.code, 1);
  assert.match(empty.stderr, /No Plan records found/);
  const nonexistent = await run(['--root', join(root, 'missing')]);
  assert.equal(nonexistent.code, 1);
  assert.match(nonexistent.stderr, /record root does not exist or is not a directory/);
});

test('progress rejects ambiguous revisions and graph references it cannot draw', async t => {
  for (const [overrides, message] of [
    [{ plans: [plan, plan] }, /duplicate plan record id/],
    [{ plans: [{ ...plan, outcomes: [...plan.outcomes, plan.outcomes[0]] }] }, /duplicate outcome id/],
    [{ slices: [{ ...slice, contributesTo: ['missing'] }] }, /references unknown criterion missing/],
    [{ slices: [slice, slice] }, /duplicate slice record id/],
    [{ reconciliations: [{ ...reconciliation, criterionAssessments: [reconciliation.criterionAssessments[0], reconciliation.criterionAssessments[0]] }] }, /duplicate assessment/]
  ]) {
    const root = writeProjectRoot(t, overrides);
    const result = await run(['--root', root]);
    assert.equal(result.code, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, message);
  }
});

test('progress example: render the complete SSO example records in a project root', async t => {
  const example = name => JSON.parse(readFileSync(join('examples', name), 'utf8'));
  const root = writeProjectRoot(t, {
    plans: [example('plan-sso.json')],
    reconciliations: [example('reconciliation-001.json')],
    slices: [example('slice-001.json')]
  });
  const result = await run(['--root', root]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^# Corporate SSO \(revision 1\)/);
  assert.ok(result.stdout.includes('outcome_sso["sso · 50% (0 of 1 achieved, 1 partly)"]'));
  assert.ok(result.stdout.includes('slice_slice_001 --> criterion_ac_1'));
  assert.ok(result.stdout.includes('| ac-1 | sso | Corporate users authenticate with SSO. | partially-verified | {"kind":"repository","repositoryId":"web","commit":"81fee032","path":"src/auth/provider.ts"} | SSO login succeeds. |'));
  const sample = readFileSync('README.md', 'utf8').split('````markdown\n')[1].split('````')[0];
  assert.equal(result.stdout, sample);
});
