// apps/web must not hand-build Authorization headers outside src/lib/api.ts.
// Hand-rolled fetches drift from the api() helper: wrong localStorage key (#232), no 401
// redirect, no refresh. 7d10f7f replaced 19 of them with api().
import { test } from 'node:test';
import { assertRatchet, read, sourceFiles } from './lib.mjs';

const HELPER = 'apps/web/src/lib/api.ts';

// Known sites in today's tree, per file with a count. Lower or delete when you migrate one.
const ALLOWLIST = {
  'apps/web/src/app/[locale]/[coopSlug]/laadpas/entry.tsx': {
    count: 1,
    reason: 'public charge-card page uses its own token; migrate to api()',
  },
  'apps/web/src/components/coop-register-content.tsx': {
    count: 3,
    reason: 'public register flow; migrate to api()',
  },
  'apps/web/src/app/[locale]/dashboard/admin/settings/settings-page.tsx': {
    count: 1,
    reason: "legitimate: tests the user's MCP API key, not the session token",
  },
};

// `Authorization:` / 'Authorization' as a header key, or a `Bearer ${...}` / 'Bearer ' + value.
const HEADER = /['"]?\bAuthorization['"]?\s*[:,]|`Bearer \$\{|['"]Bearer ['"]\s*\+/;

test('no hand-built Authorization header outside lib/api.ts', () => {
  const found = new Map();
  for (const file of sourceFiles('apps/web/src', { exts: /\.(ts|tsx|js|jsx)$/, skipSpecs: true })) {
    if (file === HELPER) continue;
    const lines = read(file)
      .split('\n')
      .filter((l) => !/^\s*(\/\/|\*)/.test(l) && HEADER.test(l));
    if (lines.length) found.set(file, lines.length);
  }
  assertRatchet({
    found,
    allowlist: ALLOWLIST,
    mistake:
      'a web file builds its own Authorization/Bearer header instead of using the api() helper.',
    fix: "call api() from '@/lib/api'; it attaches the token, parses JSON, and handles 401.",
    file: 'scripts/guardrails/no-bearer-outside-api.test.mjs',
  });
});
