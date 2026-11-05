import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { loadFrontend } from './loadFrontend.js';

const source = await readFile(new URL('../../src/lib/apiBase.ts', import.meta.url), 'utf8');
async function apiBase(environment) {
  const module = await loadFrontend(source.replaceAll('import.meta.env', JSON.stringify(environment)));
  return module.API_BASE;
}

test('development uses the local proxy even when the production backend is configured', async () => {
  assert.equal(await apiBase({ DEV: true, VITE_API_BASE_URL: 'https://production.example' }), '/api');
});

test('production retains its configured backend and same-origin fallback', async () => {
  assert.equal(await apiBase({ DEV: false, VITE_API_BASE_URL: 'https://production.example/' }), 'https://production.example/api');
  assert.equal(await apiBase({ DEV: false }), '/api');
});
