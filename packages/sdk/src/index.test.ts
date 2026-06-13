import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_GATEWAY_URL, SDK_VERSION } from './index.js';

test('sdk package smoke test', () => {
  assert.equal(typeof SDK_VERSION, 'string');
});

test('DEFAULT_GATEWAY_URL is re-exported from the package root', () => {
  // Regression guard: it must be importable from '@querais/sdk', not just './client.js'.
  assert.equal(DEFAULT_GATEWAY_URL, 'https://gateway.querais.xyz');
});
