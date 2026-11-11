import { ForbiddenException } from '@nestjs/common';

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

/** Public registration may name an existing shareholder only when that person is signed in. */
export function assertCanBuyForShareholder(
  shareholder: ShareholderOwnership,
  actorUserId: string | undefined,
): void {
  if (!actorUserId || !canActForShareholder(shareholder, actorUserId)) {
    throw new ForbiddenException('Sign in as this shareholder to register more shares');
  }
}
