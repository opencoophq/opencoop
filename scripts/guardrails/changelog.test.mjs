// CHANGELOG.md `## [x]` headings: [Unreleased] first, each version once, newest first.
// Two PRs once both added `## [2026.39.3]` (#197); another added a pre-CalVer `0.8.39`
// heading above CalVer ones (#135). Not covered: an entry added under a version that is
// already tagged (needs git tags). Plain `##` headings without brackets are ignored.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertRatchet, read } from './lib.mjs';

// Known breaks in today's file. Delete an entry if the history is reordered.
const ALLOWLIST = {
  '[0.1.46] comes after [0.1.43] but is not lower': {
    reason: 'historical: 0.1.46/0.1.45 were inserted below 0.1.44/0.1.43 in Feb 2026',
  },
};

const cmp = (a, b) => {
  const [x, y] = [a, b].map((v) => v.split('.').map(Number));
  for (let i = 0; i < Math.max(x.length, y.length); i++)
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
};

test('CHANGELOG headings: Unreleased first, unique, strictly descending', () => {
  const headings = [...read('CHANGELOG.md').matchAll(/^## \[([^\]]+)\]/gm)].map((m) => m[1]);
  assert.ok(headings.length > 10, 'Found almost no `## [x]` headings; fix the scanner.');
  const found = new Map();
  if (headings[0] !== 'Unreleased')
    found.set(`first heading is [${headings[0]}], not [Unreleased]`, 1);
  const versions = headings.slice(1);
  for (const [i, v] of versions.entries()) {
    const problem = !/^\d+(\.\d+){2,3}$/.test(v)
      ? `[${v}] is not a version (or is a second [Unreleased])`
      : versions.indexOf(v) !== i
        ? `[${v}] appears more than once`
        : i > 0 && /^\d/.test(versions[i - 1]) && cmp(versions[i - 1], v) <= 0
          ? `[${v}] comes after [${versions[i - 1]}] but is not lower`
          : null;
    if (problem) found.set(problem, 1);
  }
  assertRatchet({
    found,
    allowlist: ALLOWLIST,
    mistake: 'CHANGELOG.md `## [x]` headings are not [Unreleased] first, unique, and newest first.',
    fix: 'put new entries under `## [Unreleased]` at the top; at release, keep an empty `## [Unreleased]` and move its entries under a new version heading below it, higher than every version further down and not already present.',
    file: 'scripts/guardrails/changelog.test.mjs',
  });
});
