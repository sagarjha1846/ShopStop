#!/usr/bin/env node
/**
 * Runs every black-box E2E suite in sequence and aggregates the result.
 *
 *   node test/e2e/run-all.mjs
 *
 * Exits non-zero if any suite fails, so CI can gate on a single command.
 *
 * Note on repeatability: these suites publish listings as the seeded demo admin, and
 * the risk engine holds a seller who posts 10+ listings in an hour (that rule is
 * working as intended — it is what catches listing spam). A full pass creates enough
 * listings that a second back-to-back pass can trip it, so re-run against a freshly
 * seeded database: `pnpm db:reset`.
 */
import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.API_BASE_URL ?? 'http://localhost:4000/api/v1';

// Fail fast with a clear message rather than a wall of connection errors.
try {
  const res = await fetch(`${BASE.replace(/\/api\/v1$/, '')}/api/v1/health/ready`);
  if (!res.ok) throw new Error(`health ${res.status}`);
} catch (err) {
  console.error(`Cannot reach the API at ${BASE} — is it running?  (${String(err)})`);
  process.exit(1);
}

const suites = (await readdir(here))
  .filter((f) => f.endsWith('.e2e.mjs'))
  .sort();

const run = (file) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [join(here, file)], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => resolve({ file, code, out }));
  });

const results = [];
for (const file of suites) {
  const r = await run(file);
  results.push(r);
  // Last line of each suite is its own "N passed, M failed" summary.
  const summary = r.out.trimEnd().split('\n').pop() ?? '';
  const name = file.replace('.e2e.mjs', '');
  console.log(`${r.code === 0 ? 'ok  ' : 'FAIL'}  ${name.padEnd(16)} ${summary}`);
  if (r.code !== 0) console.log(r.out.replace(/^/gm, '        '));
}

const failed = results.filter((r) => r.code !== 0);
console.log(`\n${results.length - failed.length}/${results.length} suites passed`);
process.exit(failed.length ? 1 : 0);
