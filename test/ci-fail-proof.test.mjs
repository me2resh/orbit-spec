import test from 'node:test';
import assert from 'node:assert/strict';

// Scratch-branch proof for #37: CI must fail when a test fails. Never merge.
test('ci fail proof', () => {
  assert.equal(1, 2);
});
