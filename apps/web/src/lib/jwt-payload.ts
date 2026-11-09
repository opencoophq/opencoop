/** Decode the payload segment of a JWT. JWT segments are base64url, not base64. */
export function decodeJwtPayload<T = Record<string, unknown>>(token: string): T {
  const segment = token.split('.')[1];
  if (!segment) throw new Error('Malformed JWT');
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const utf8 = binary.replace(/[\s\S]/g, (c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'));
  return JSON.parse(decodeURIComponent(utf8)) as T;
}
