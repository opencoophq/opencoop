// Every literal key passed to a next-intl translator in apps/web/src must exist in en.json.
// A typo or a wrong namespace renders the raw key on screen (7453d67, 5037f27, #125).
// Conservative: non-literal and template-literal keys are skipped, and when one variable is
// bound to several namespaces in a file, a key passes if it resolves under any of them.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertRatchet, flattenKeys, read, readJson, sourceFiles } from './lib.mjs';

const ALLOWLIST = {};

// const t = useTranslations('ns') | await getTranslations('ns' | { namespace: 'ns' }) | (...)
const BINDING =
  /\b(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*([^)]*?)\s*\)/g;
// t: ReturnType<typeof useTranslations<'ns'>> (translator passed to a helper)
const TYPED_PARAM = /\b(\w+)\s*:\s*ReturnType<typeof useTranslations<\s*['"]([^'"]+)['"]\s*>>/g;

// Namespace from the call argument: '' = root, null = unknown (skip this variable).
function namespaceOf(arg) {
  if (arg === '') return '';
  const lit = arg.match(/^(['"])([^'"]*)\1$/);
  if (lit) return lit[2];
  if (arg.startsWith('{')) {
    if (!/\bnamespace\b/.test(arg)) return '';
    const ns = arg.match(/\bnamespace\s*:\s*(['"])([^'"]*)\1/);
    return ns ? ns[2] : null;
  }
  return null;
}

test('every literal translation key resolves in en.json', () => {
  const en = flattenKeys(readJson('apps/web/messages/en.json'));
  const found = new Map();
  let checked = 0;
  for (const file of sourceFiles('apps/web/src', { exts: /\.(ts|tsx)$/, skipSpecs: true })) {
    const src = read(file);
    const bindings = new Map(); // var -> Set of namespaces (null = unknown)
    const bind = (name, ns) => bindings.set(name, (bindings.get(name) ?? new Set()).add(ns));
    for (const m of src.matchAll(BINDING)) bind(m[1], namespaceOf(m[2]));
    for (const m of src.matchAll(TYPED_PARAM)) bind(m[1], m[2]);
    for (const [name, namespaces] of bindings) {
      if (namespaces.has(null)) continue;
      const call = new RegExp(
        `(?<![\\w.$])${name}(?:\\.(?:rich|raw|markup))?\\(\\s*(['"])([^'"\\n]+)\\1\\s*[,)]`,
        'g',
      );
      for (const m of src.matchAll(call)) {
        const key = m[2];
        checked++;
        const ok = [...namespaces].some((ns) => en.has(ns ? `${ns}.${key}` : key));
        if (!ok)
          found.set(
            `${file}: ${name}('${key}') in namespace '${[...namespaces].join("' | '")}'`,
            1,
          );
      }
    }
  }
  // 2829 calls today; a near-zero count means the scanner broke, not that the code is clean.
  assert.ok(checked > 1000, `Scanner found only ${checked} translator calls; fix the regexes.`);
  assertRatchet({
    found,
    allowlist: ALLOWLIST,
    mistake:
      'a translation key does not exist in apps/web/messages/en.json (typo or wrong namespace).',
    fix: 'use an existing key, or add the key to en/nl/fr/de.json under the namespace the translator was created with.',
    file: 'scripts/guardrails/t-keys.test.mjs',
  });
});
