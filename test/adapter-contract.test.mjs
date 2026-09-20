import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['bin/orbit.js', command, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('close', code => resolve({ code, stdout, stderr }));
    child.on('error', reject);
  });
}

test('adapter contract: every standard operation validates its fixture', async () => {
  const cases = [
    ['plan', 'examples/plan-minimal.json'],
    ['snapshot', 'examples/project-snapshot-minimal.json'],
    ['reconcile', 'examples/reconciliation-minimal.json'],
    ['slice', 'examples/slice-minimal.json']
  ];
  for (const [command, file] of cases) {
    const result = await run(command, [file]);
    assert.equal(result.code, 0, `${command}: ${result.stderr}`);
  }
});

test('generic adapter contract validates the complete repository', async () => {
  const result = await run('validate', ['--all']);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Validated \d+ ORBIT records/);
});
