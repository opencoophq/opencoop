import * as fs from 'fs';
import * as path from 'path';

export const API_URL = process.env.API_URL || 'http://localhost:3001';

type Role = 'admin' | 'shareholder';

/**
 * A fresh access token for a role, from the refresh token that global-setup
 * stored in .auth/<role>.json. No extra login: /auth/login is throttled to
 * 5 per minute, and global-setup already uses 2.
 */
export async function tokenFor(role: Role): Promise<string> {
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
  return ((await res.json()) as { accessToken: string }).accessToken;
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
