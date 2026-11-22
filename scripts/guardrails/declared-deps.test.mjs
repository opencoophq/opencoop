// Every package an app imports must be declared in that app's own package.json.
// `shamefully-hoist=true` in .npmrc lets an undeclared import work locally and then break in
// the Docker build (2798a42: csv-parse). Also: zod must have one major across workspaces
// (#251: zod 3 in one package, zod 4 in another).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { builtinModules } from 'node:module';
import { assertRatchet, ROOT, read, readJson, sourceFiles } from './lib.mjs';

const APPS = ['apps/api', 'apps/web'];
const SAME_MAJOR = ['zod']; // all deps fails today (next 14 in apps/docs, 15 in apps/web)

// Known gaps in today's tree, as `<app>:<package>`. Delete when the package is declared.
const ALLOWLIST = {
  'apps/api:express': {
    reason: 'types via @types/express, runtime via @nestjs/platform-express; declare it',
  },
};

const IMPORT =
  /(?:^\s*(?:import|export)\s[^'"]*?\bfrom\s*|^\s*import\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)(['"])([^'"\n]+)\1/gm;
const PKG_NAME = /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*/;

const declared = (pkg) =>
  new Set(
    ['dependencies', 'devDependencies', 'peerDependencies'].flatMap((s) =>
      Object.keys(pkg[s] ?? {}),
    ),
  );

// tsconfig "paths" prefixes such as '@/' are aliases, not packages.
function aliases(app) {
  const file = `${app}/tsconfig.json`;
  if (!fs.existsSync(`${ROOT}/${file}`)) return [];
  const paths = read(file).match(/"paths"\s*:\s*\{([^}]*)\}/);
  return paths ? [...paths[1].matchAll(/"([^"*]+)\*?"\s*:/g)].map((m) => m[1]) : [];
}

test('every imported package is declared in the importing app', () => {
  const found = new Map();
  let scanned = 0;
  for (const app of APPS) {
    const deps = declared(readJson(`${app}/package.json`));
    const skip = ['.', '/', 'node:', '@/', ...aliases(app)];
    for (const file of sourceFiles(`${app}/src`)) {
      for (const m of read(file).matchAll(IMPORT)) {
        const spec = m[2];
        scanned++;
        if (skip.some((p) => spec.startsWith(p))) continue;
        const name = spec.match(PKG_NAME)?.[0];
        if (!name || builtinModules.includes(name) || deps.has(name)) continue;
        found.set(`${app}:${name}`, 1);
      }
    }
  }
  assert.ok(scanned > 1000, `Scanner found only ${scanned} imports; fix the IMPORT regex.`);
  assertRatchet({
    found,
    allowlist: ALLOWLIST,
    mistake:
      'an app imports a package that is not in its own package.json (works only via hoisting).',
    fix: 'run `pnpm --filter <app> add <package>` (or add -D for test/type-only use).',
    file: 'scripts/guardrails/declared-deps.test.mjs',
  });
});

test('shared dependencies use one major version across workspaces', () => {
  const dirs = ['apps', 'packages'].flatMap((d) =>
    fs.readdirSync(`${ROOT}/${d}`).map((x) => `${d}/${x}/package.json`),
  );
  const pkgs = dirs.filter((f) => fs.existsSync(`${ROOT}/${f}`)).map((f) => [f, readJson(f)]);
  const found = new Map();
  for (const dep of SAME_MAJOR) {
    const ranges = pkgs.flatMap(([f, p]) =>
      ['dependencies', 'devDependencies', 'peerDependencies']
        .map((s) => p[s]?.[dep])
        .filter(Boolean)
        .map((r) => `${f}: ${r}`),
    );
    const majors = new Set(ranges.map((r) => r.split(': ')[1].match(/\d+/)?.[0]));
    if (majors.size > 1) found.set(`${dep} -> ${ranges.join(', ')}`, 1);
  }
  assertRatchet({
    found,
    allowlist: {},
    mistake: 'one dependency has different major versions in different workspace packages.',
    fix: 'align the range in every package.json to the same major, then run pnpm install.',
    file: 'scripts/guardrails/declared-deps.test.mjs',
  });
});
