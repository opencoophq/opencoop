import * as fs from 'fs';
import * as path from 'path';

export const API_URL = process.env.API_URL || 'http://localhost:3001';

type Role = 'admin' | 'shareholder';

const tokens = new Map<Role, { value: string; at: number }>();
// Access tokens outlive a test run; refresh at most every 5 minutes per worker.
const TOKEN_TTL_MS = 5 * 60 * 1000;

/**
 * An access token for a role, from the refresh token that global-setup
 * stored in .auth/<role>.json. No extra login: /auth/login is throttled to
 * 5 per minute, and global-setup already uses 2. /auth/refresh is throttled
 * to 10 per minute, so the token is cached per worker instead of refreshed
 * on every API call.
 */
export async function tokenFor(role: Role): Promise<string> {
  const cached = tokens.get(role);
  if (cached && Date.now() - cached.at < TOKEN_TTL_MS) return cached.value;
  const file = path.resolve(__dirname, '..', '.auth', `${role}.json`);
  const state = JSON.parse(fs.readFileSync(file, 'utf-8')) as {
    origins: Array<{ localStorage: Array<{ name: string; value: string }> }>;
  };
  const refreshToken = state.origins.flatMap((o) => o.localStorage).find((e) => e.name === 'refreshToken')?.value;
  if (!refreshToken) throw new Error(`${file} has no refreshToken`);
  const res = await fetch(`${API_URL}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  if (!res.ok) throw new Error(`refresh for ${role} failed: ${res.status}`);
  const { accessToken } = (await res.json()) as { accessToken: string };
  tokens.set(role, { value: accessToken, at: Date.now() });
  return accessToken;
}

export async function apiAs<T>(role: Role, method: 'GET' | 'POST' | 'PUT', urlPath: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${urlPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${await tokenFor(role)}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${urlPath} failed: ${res.status} ${await res.text()}`);
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Turns charge cards on for the seeded demo coop and returns its id. */
export async function enableChargeCards(): Promise<string> {
  const me = await apiAs<{ adminCoops: Array<{ id: string; slug: string }> }>('admin', 'GET', '/auth/me');
  const coop = me.adminCoops.find((c) => c.slug === 'demo');
  if (!coop) throw new Error('the e2e admin has no access to the demo coop');
  await apiAs('admin', 'PUT', `/admin/coops/${coop.id}/settings`, { chargeCardsEnabled: true });
  return coop.id;
}
