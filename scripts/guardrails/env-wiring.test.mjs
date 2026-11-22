// Every env var the API reads must be passed to the api service in deploy/docker-compose.yml.
// Prod and acc run that file (hand-copied to the host, see docs/OPERATIONS.md). A var read in
// code but missing there is undefined in prod: passkeys (#182) and Ponto (#183) broke this way.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertRatchet, read, sourceFiles } from './lib.mjs';

const COMPOSE = 'deploy/docker-compose.yml';

// Known gaps in today's tree. Delete an entry when the var is wired or no longer read.
const ALLOWLIST = {
  API_PORT: { reason: 'listen port; main.ts falls back to 3001, which the healthcheck expects' },
  PORT: { reason: 'listen port fallback after API_PORT in main.ts' },
  API_PUBLIC_URL: { reason: 'optional; meeting documents fall back to FRONTEND_URL + /api' },
  API_URL: { reason: 'gift PDF logo falls back to localhost:3001, the API itself' },
  API_THROTTLE_LIMIT: { reason: 'Playwright-only override; default 100 in throttle-limit.ts' },
  EMAIL_LOG_RETENTION_DAYS: { reason: 'optional; retention.service.ts defaults to 180' },
  JWT_EXPIRES_IN: { reason: "optional; auth.module.ts defaults to '7d'" },
  MEETING_TIME_ZONE: { reason: "optional; email.processor.ts defaults to 'Europe/Brussels'" },
  SENTRY_ENVIRONMENT: { reason: 'known gap, see #207 (set only in the hand-managed host file)' },
  TEST_DATABASE_URL: { reason: 'test-only, read by src/test-utils/test-db.ts' },
  UPLOAD_DIR: { reason: "optional; defaults to 'uploads', which is the mounted /app/uploads" },
};

const READS = [
  /process\.env\.([A-Z][A-Z0-9_]*)/g,
  /process\.env\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\]/g,
  /[cC]onfig\w*\??\.(?:get|getOrThrow)(?:<[^>()]*>)?\(\s*['"]([A-Z][A-Z0-9_]*)['"]/g,
  /(?<![\w.])env\.([A-Z][A-Z0-9_]*)/g, // helpers taking `env: NodeJS.ProcessEnv = process.env`
  /requireEnv\(\s*['"]([A-Z][A-Z0-9_]*)['"]/g,
];

function apiComposeEnv() {
  const lines = read(COMPOSE).split('\n');
  const start = lines.findIndex((l) => /^ {2}api:\s*$/.test(l));
  const vars = new Set();
  let inEnv = false;
  for (const line of lines.slice(start + 1)) {
    if (/^ {0,2}[^\s#]/.test(line)) break; // next service or top-level key
    if (/^ {4}[^\s#]/.test(line)) inEnv = /^ {4}environment:\s*$/.test(line);
    else if (inEnv) {
      const m = line.match(/^ {6,}(?:-\s*)?([A-Z][A-Z0-9_]*)\s*[:=]/);
      if (m) vars.add(m[1]);
    }
  }
  if (start < 0 || vars.size === 0) throw new Error(`No api environment found in ${COMPOSE}`);
  return vars;
}

test('every env var the API reads is wired into the prod compose file', () => {
  const wired = apiComposeEnv();
  const found = new Map();
  const seen = new Set();
  for (const file of sourceFiles('apps/api/src', { exts: /\.ts$/, skipSpecs: true })) {
    const src = read(file);
    for (const re of READS)
      for (const m of src.matchAll(re)) {
        seen.add(m[1]);
        if (!wired.has(m[1])) found.set(m[1], 1);
      }
  }
  assert.ok(seen.size > 30, `Scanner found only ${seen.size} env vars; fix the READS regexes.`);
  assertRatchet({
    found,
    allowlist: ALLOWLIST,
    mistake: `the API reads an env var that ${COMPOSE} does not pass to the api service.`,
    fix: `add \`VAR: \${VAR:-}\` under services.api.environment in ${COMPOSE}, add it to deploy/.env.example, and set it on the acc/prod hosts.`,
    file: 'scripts/guardrails/env-wiring.test.mjs',
  });
});
