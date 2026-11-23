// en, nl, fr and de must have the same flattened keys with the same leaf types.
// A key that exists in one locale only shows the raw key (or crashes) in the others.
import { test } from 'node:test';
import { assertRatchet, flattenKeys, readJson } from './lib.mjs';

const LOCALES = ['en', 'nl', 'fr', 'de'];

// Known gaps in today's tree, as `<locale>:<key>`. Delete an entry when it is translated.
const ALLOWLIST = {
  'fr:settings.setPassword': { reason: 'not yet translated (open gap since 4c6adee)' },
  'fr:settings.setPasswordDescription': { reason: 'not yet translated (open gap since 4c6adee)' },
  'fr:mfa.requiresPassword': { reason: 'not yet translated (open gap since 4c6adee)' },
  'de:settings.setPassword': { reason: 'not yet translated (open gap since 4c6adee)' },
  'de:settings.setPasswordDescription': { reason: 'not yet translated (open gap since 4c6adee)' },
  'de:mfa.requiresPassword': { reason: 'not yet translated (open gap since 4c6adee)' },
};

test('all locale files have the same keys and leaf types', () => {
  const maps = Object.fromEntries(
    LOCALES.map((l) => [l, flattenKeys(readJson(`apps/web/messages/${l}.json`))]),
  );
  const allKeys = new Set(LOCALES.flatMap((l) => [...maps[l].keys()]));
  const found = new Map();
  for (const key of allKeys) {
    const ref = maps.en.get(key) ?? LOCALES.map((l) => maps[l].get(key)).find(Boolean);
    for (const l of LOCALES) {
      const type = maps[l].get(key);
      if (!type) found.set(`${l}:${key}`, 1);
      else if (type !== ref) found.set(`${l}:${key} is ${type}, expected ${ref}`, 1);
    }
  }
  assertRatchet({
    found,
    allowlist: ALLOWLIST,
    mistake: 'a translation key is missing in a locale, or has a different type there.',
    fix: 'add the key to every file in apps/web/messages/{en,nl,fr,de}.json with the same shape.',
    file: 'scripts/guardrails/locale-parity.test.mjs',
  });
});
