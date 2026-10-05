export interface ShareholderOwnership {
  userId: string | null;
  type: string;
  registeredByUserId: string | null;
}

/** A user may act for their own shareholder record, or for a minor they registered. */
export function canActForShareholder(shareholder: ShareholderOwnership, userId: string): boolean {
  if (shareholder.userId === userId) return true;
  return shareholder.type === 'MINOR' && shareholder.registeredByUserId === userId;
}
