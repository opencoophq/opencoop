'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { useBillingStatus } from '@/hooks/use-billing-status';
import { Button } from '@/components/ui/button';
import { CreditCard } from 'lucide-react';

interface BillingGateProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

/**
 * Wraps action buttons to show an upgrade prompt when the coop is in read-only mode.
 * Usage: <BillingGate><Button>Create</Button></BillingGate>
 */
export function BillingGate({ children, fallback }: BillingGateProps) {
  const t = useTranslations('admin.billing');
  const { isReadOnly } = useBillingStatus();

  if (!isReadOnly) {
    return <>{children}</>;
  }

  if (fallback) {
    return <>{fallback}</>;
  }

  return (
    <Link href="/dashboard/admin/billing">
      <Button variant="outline" size="sm" className="gap-2">
        <CreditCard className="h-4 w-4" />
        {t('upgradeToUnlock')}
      </Button>
    </Link>
  );
}
