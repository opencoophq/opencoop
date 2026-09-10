'use client';

import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';

export type ShareholderStatus = 'PENDING' | 'ACTIVE' | 'INACTIVE';

interface ShareholderStatusBadgeProps {
  status: ShareholderStatus;
}

export function ShareholderStatusBadge({ status }: ShareholderStatusBadgeProps) {
  const t = useTranslations();

  return (
    <Badge
      variant={status === 'ACTIVE' ? 'default' : status === 'PENDING' ? 'secondary' : 'destructive'}
    >
      {t(`shareholder.statuses.${status}`)}
    </Badge>
  );
}
