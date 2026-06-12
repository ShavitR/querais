import { test } from 'node:test';
import assert from 'node:assert/strict';
import { digestFor, selectServedModels, withDefaultTag } from './models.js';

test('selectServedModels matches a bare name against Ollama’s :latest tag', () => {
  // The headline bug: DAEMON_MODELS=llama3.2 vs Ollama's llama3.2:latest.
  assert.deepEqual(selectServedModels(['llama3.2'], ['llama3.2:latest', 'qwen3:1.7b']), [
    'llama3.2',
  ]);
});

test('selectServedModels keeps exact and already-tagged matches', () => {
  assert.deepEqual(selectServedModels(['gemma3:4b'], ['gemma3:4b']), ['gemma3:4b']);
  assert.deepEqual(selectServedModels(['m1'], ['m1', 'm2']), ['m1']);
});

test('selectServedModels drops genuinely-absent models', () => {
  assert.deepEqual(selectServedModels(['nope'], ['llama3.2:latest']), []);
});

test('selectServedModels with no config serves everything the backend reports', () => {
  assert.deepEqual(selectServedModels([], ['a', 'b']), ['a', 'b']);
});

test('digestFor resolves a bare name to its :latest digest', () => {
  assert.equal(digestFor('llama3.2', { 'llama3.2:latest': 'sha256:abc' }), 'sha256:abc');
  assert.equal(digestFor('gemma3:4b', { 'gemma3:4b': 'sha256:def' }), 'sha256:def');
  assert.equal(digestFor('missing', {}), undefined);
});

test('withDefaultTag adds :latest only when untagged', () => {
  assert.equal(withDefaultTag('llama3.2'), 'llama3.2:latest');
  assert.equal(withDefaultTag('gemma3:4b'), 'gemma3:4b');
});
