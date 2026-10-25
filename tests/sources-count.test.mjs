// The Sources tab must never show a misleading "0 source routes checked" (e.g. to signed-out visitors).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const out = resolve('.sites-runtime/tests-sources-count'); mkdirSync(out, { recursive: true });
for (const name of ['source-parsers', 'grants', 'state-registry']) {
  const js = ts.transpileModule(readFileSync(`lib/${name}.ts`, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText.replace(/from '(\.\/[^']+)'/g, "from '$1.mjs'");
  writeFileSync(`${out}/${name}.mjs`, js);
}
const { sourceRoutesLabel } = await import(pathToFileURL(`${out}/state-registry.mjs`).href);

test('zero or unavailable route counts show the daily-check message, never 0', () => {
  for (const v of [0, undefined, null, NaN, -1, '3', Infinity]) {
    assert.equal(sourceRoutesLabel(v), 'Source routes are checked daily', String(v));
    assert.doesNotMatch(sourceRoutesLabel(v), /\b0 source routes/);
  }
});

test('a real positive count is kept', () => {
  assert.equal(sourceRoutesLabel(1), '1 source routes checked');
  assert.equal(sourceRoutesLabel(42), '42 source routes checked');
});

test('the Sources tab pill uses the label helper', () => {
  const src = readFileSync('app/state-coverage.tsx', 'utf8');
  assert.match(src, /sourceRoutesLabel\(count\)/);
  assert.doesNotMatch(src, /\{count\} source routes checked/);
});
