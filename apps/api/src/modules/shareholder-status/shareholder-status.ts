import { ShareholderStatus } from '@opencoop/database';

export function deriveShareholderStatus(
  registrations: Array<{ type: 'BUY' | 'SELL' | string; status: string; quantity: number }>,
): ShareholderStatus {
  const buyQuantity = registrations
    .filter(
      (registration) =>
        registration.type === 'BUY' &&
        (registration.status === 'ACTIVE' || registration.status === 'COMPLETED'),
    )
    .reduce((total, registration) => total + registration.quantity, 0);
  const sellQuantity = registrations
    .filter((registration) => registration.type === 'SELL' && registration.status === 'COMPLETED')
    .reduce((total, registration) => total + registration.quantity, 0);
  if (buyQuantity - sellQuantity > 0) {
    return ShareholderStatus.ACTIVE;
  }

  if (buyQuantity > 0) {
    return ShareholderStatus.INACTIVE;
  }

  return ShareholderStatus.PENDING;
}
