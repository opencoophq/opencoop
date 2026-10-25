/** Map a public-registration error body onto the string the form shows. */
export function registrationErrorMessage(
  body: { code?: unknown; message?: unknown } | null | undefined,
  signupClosedMessage: string,
): string {
  if (body?.code === 'SIGNUP_CLOSED') return signupClosedMessage;
  if (typeof body?.message === 'string' && body.message.trim()) return body.message;
  return 'Registration failed';
}
