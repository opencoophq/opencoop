// Shared helpers for the guardrail tests. Built-ins only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
export const readJson = (rel) => JSON.parse(read(rel));

// Source files under `rel`, as repo-relative paths with forward slashes.
export function sourceFiles(rel, { exts = /\.(ts|tsx|js|jsx|mjs)$/, skipSpecs = false } = {}) {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) {
        if (e.name !== 'node_modules' && e.name !== '.next') walk(p);
      } else if (exts.test(e.name) && !(skipSpecs && /\.spec\.[jt]sx?$/.test(e.name))) {
        out.push(p);
      }
    }
  };
  walk(rel);
  return out;
}

// Flatten a JSON object into Map<'a.b.c', 'string' | 'object' | 'array' | ...>.
export function flattenKeys(obj, prefix = '', out = new Map()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    const type = Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v;
    out.set(key, type);
    if (type === 'object') flattenKeys(v, key, out);
  }
  return out;
}

// Ratchet: `found` maps violation -> count. `allowlist` maps violation -> { count?, reason }.
// Fails on a new violation, on a count above the allowed count, and on a stale entry
// (fixed, or count now lower), so the allowlist can only shrink.
export function assertRatchet({ found, allowlist, mistake, fix, file }) {
  const problems = [];
  for (const [key, count] of found) {
    const allowed = allowlist[key];
    if (!allowed) problems.push(`NEW   ${key}${count > 1 ? ` (x${count})` : ''}`);
    else if (allowed.count !== undefined && count > allowed.count)
      problems.push(`MORE  ${key}: ${count} found, allowlist permits ${allowed.count}`);
  }
  const stale = [];
  for (const [key, allowed] of Object.entries(allowlist)) {
    const count = found.get(key) ?? 0;
    if (count === 0) stale.push(`STALE ${key}: fixed, delete it from the allowlist`);
    else if (allowed.count !== undefined && count < allowed.count)
      stale.push(`STALE ${key}: ${count} left, lower the allowlist count to ${count}`);
  }
  const msg = [];
  if (problems.length) msg.push(`Mistake: ${mistake}`, ...problems, `Fix: ${fix}`);
  if (stale.length) msg.push(`Allowlist in ${file} is out of date:`, ...stale);
  assert.ok(msg.length === 0, msg.join('\n'));
}

// Count occurrences into a Map.
export const tally = (items) => {
  const m = new Map();
  for (const i of items) m.set(i, (m.get(i) ?? 0) + 1);
  return m;
};
