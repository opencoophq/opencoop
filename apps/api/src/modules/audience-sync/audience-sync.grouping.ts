import { resolveShareholderEmail } from '../shareholders/shareholder-email.resolver';

/**
 * Shareholders that share one resolved email become one Brevo contact.
 *
 * The contact's EXT_ID is the primary shareholder:
 * 1. Prefer shareholders whose own User owns the email
 *    (`User.email` normalizes to the group email). A family member linked to
 *    someone else's user falls into this pool only when that user really owns
 *    the address. If several qualify, the oldest `createdAt` wins, then the
 *    lowest id (deterministic).
 * 2. Otherwise the oldest shareholder in the group (same tie-break).
 *
 * Everyone else is secondary. Their old contact (EXT_ID = their own id) is
 * unlinked from the coop's managed lists. Contacts are never deleted.
 *
 * The shared contact's list membership follows the primary's status.
 */
export interface GroupableShareholder {
  id: string;
  status: string;
  email: string | null;
  createdAt: Date;
  userId?: string | null;
  user: { email: string | null } | null;
}

export interface EmailGroup<T extends GroupableShareholder> {
  /** Normalized email, or null when the shareholder has none. */
  email: string | null;
  /** When `email` is set, index 0 is the primary. */
  shareholders: T[];
}

export function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const normalized = email.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

export function resolvedGroupEmail(shareholder: GroupableShareholder): string | null {
  return normalizeEmail(resolveShareholderEmail(shareholder));
}

function compareOldest(a: GroupableShareholder, b: GroupableShareholder): number {
  const delta = a.createdAt.getTime() - b.createdAt.getTime();
  if (delta !== 0) return delta;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

export function selectPrimary<T extends GroupableShareholder>(
  shareholders: readonly T[],
  groupEmail: string,
): T {
  if (shareholders.length === 0) {
    throw new Error('selectPrimary requires at least one shareholder');
  }
  const owners = shareholders.filter(
    (shareholder) => normalizeEmail(shareholder.user?.email) === groupEmail,
  );
  const pool = owners.length > 0 ? owners : shareholders;
  return [...pool].sort(compareOldest)[0];
}

export function groupShareholdersByEmail<T extends GroupableShareholder>(
  shareholders: readonly T[],
): EmailGroup<T>[] {
  const buckets = new Map<string, T[]>();
  const noEmail: T[] = [];

  for (const shareholder of shareholders) {
    const email = resolvedGroupEmail(shareholder);
    if (!email) {
      noEmail.push(shareholder);
      continue;
    }
    const list = buckets.get(email);
    if (list) list.push(shareholder);
    else buckets.set(email, [shareholder]);
  }

  const groups: EmailGroup<T>[] = [];
  for (const email of [...buckets.keys()].sort()) {
    const members = buckets.get(email) ?? [];
    const primary = selectPrimary(members, email);
    const secondaries = members
      .filter((shareholder) => shareholder.id !== primary.id)
      .sort(compareOldest);
    groups.push({ email, shareholders: [primary, ...secondaries] });
  }

  for (const shareholder of [...noEmail].sort(compareOldest)) {
    groups.push({ email: null, shareholders: [shareholder] });
  }

  return groups;
}
