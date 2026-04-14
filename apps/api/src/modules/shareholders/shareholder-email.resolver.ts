export type ShareholderWithUser = {
  email: string | null;
  user: { email: string | null } | null;
};

export type EmailSource = 'user' | 'shareholder' | 'none';

export function resolveShareholderEmail(shareholder: ShareholderWithUser): string | null {
  return shareholder.user?.email ?? shareholder.email ?? null;
}

export function resolveShareholderEmailWithSource(
  shareholder: ShareholderWithUser,
): { email: string | null; source: EmailSource } {
  if (shareholder.user?.email) return { email: shareholder.user.email, source: 'user' };
  if (shareholder.email) return { email: shareholder.email, source: 'shareholder' };
  return { email: null, source: 'none' };
}
