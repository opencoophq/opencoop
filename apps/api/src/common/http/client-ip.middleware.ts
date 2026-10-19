import { NextFunction, Request, Response } from 'express';
import { isCloudflareIp, normalizeIp, parseSingleIp } from './cloudflare-ips';

/**
 * Replace the client address Express resolved with Cloudflare's visitor IP.
 *
 * Trust assumption
 * ----------------
 * Prod is Cloudflare → Caddy → the API container. `app.set('trust proxy', 2)`
 * (see main.ts) trusts those two hops and then takes the next address in
 * X-Forwarded-For. Caddy sets that header to the TCP peer it accepted, which
 * is a Cloudflare edge address (172.64.0.0/13 and the other published ranges),
 * so `req.ip` stops on the edge. That is the 172.70.x / 172.68.x value stored
 * in audit logs today.
 *
 * Cloudflare overwrites `CF-Connecting-IP` with the visitor; a browser cannot
 * choose that value on a request that actually traversed Cloudflare. This
 * middleware copies the header into `X-Forwarded-For` only when the address
 * Express already resolved is inside Cloudflare's published edge ranges. That
 * address is the peer Caddy saw. A client that bypasses Cloudflare and connects
 * to Caddy directly is recorded as themselves, `req.ip` is not an edge address,
 * and a spoofed `CF-Connecting-IP` is ignored.
 *
 * Hop-count trust already lets anyone who can open a socket to the API
 * container (the Docker network, not the public internet) invent `req.ip`.
 * This check does not widen that. It does not trust `CF-Connecting-IP` merely
 * because the header is present.
 *
 * `req.ip` is what audit logging passes through and what
 * `ThrottlerGuard.getTracker` uses for rate limits, so both follow the result.
 */
export function cloudflareClientIp(req: Request, _res: Response, next: NextFunction): void {
  const visitor = parseSingleIp(req.headers['cf-connecting-ip']);
  if (visitor && isCloudflareIp(req.ip) && normalizeIp(req.ip) !== visitor) {
    req.headers['x-forwarded-for'] = visitor;
  }
  next();
}
