'use client';

import { useAdmin } from '@/contexts/admin-context';

export function useBillingStatus() {
  const { selectedCoop } = useAdmin();

  const isReadOnly = selectedCoop?.isReadOnly ?? false;
  const plan = selectedCoop?.plan ?? 'FREE';
  const isFree = plan === 'FREE';
  const isPaid = plan !== 'FREE';
  const trialEndsAt = selectedCoop?.trialEndsAt;

  const trialDaysLeft = trialEndsAt
    ? Math.max(0, Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : 0;

  return {
    isReadOnly,
    plan,
    isFree,
    isPaid,
    trialEndsAt,
    trialDaysLeft,
  };
}
