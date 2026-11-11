/**
 * A failed `/auth/me` on the public register used to drop the login for every
 * non-OK status. 429 and 5xx are not proof the token is bad.
 */
export function shouldDropSessionAfterAuthMe(status: number): boolean {
  return status === 401 || status === 403;
}
