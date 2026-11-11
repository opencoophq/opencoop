/** Requests per minute for the global API throttler. Production stays at 100. */
export const DEFAULT_API_THROTTLE_LIMIT = 100;

/**
 * E2E runs the whole suite from one IP. The default 100/minute bucket
 * answers `/auth/me` with 429 and the shares page then looks empty.
 * Playwright sets `API_THROTTLE_LIMIT` for that process only.
 */
export function apiThrottleLimit(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.API_THROTTLE_LIMIT;
  if (raw === undefined || raw.trim() === '') return DEFAULT_API_THROTTLE_LIMIT;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_API_THROTTLE_LIMIT;
  return parsed;
}
