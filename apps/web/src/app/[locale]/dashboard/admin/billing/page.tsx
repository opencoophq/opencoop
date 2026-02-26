'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAdmin } from '@/contexts/admin-context';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CreditCard, Check, Clock, AlertTriangle, ExternalLink, Loader2 } from 'lucide-react';

interface BillingInfo {
  plan: 'FREE' | 'ESSENTIALS' | 'PROFESSIONAL';
  trialEndsAt?: string;
  isReadOnly: boolean;
  subscription?: {
    id: string;
    status: string;
    billingPeriod: string;
    currentPeriodStart?: string;
    currentPeriodEnd?: string;
    cancelAtPeriodEnd: boolean;
    canceledAt?: string;
  };
}

export default function BillingPage() {
  const t = useTranslations('admin.billing');
  const { selectedCoop } = useAdmin();
  const searchParams = useSearchParams();
  const [billing, setBilling] = useState<BillingInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);

  const success = searchParams.get('success');
  const canceled = searchParams.get('canceled');

  useEffect(() => {
    if (!selectedCoop) return;
    setLoading(true);
    api<BillingInfo>(`/admin/coops/${selectedCoop.id}/billing`)
      .then(setBilling)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [selectedCoop]);

  const handleCheckout = async (plan: 'ESSENTIALS' | 'PROFESSIONAL', billingPeriod: 'MONTHLY' | 'YEARLY') => {
    if (!selectedCoop) return;
    setCheckoutLoading(true);
    try {
      const result = await api<{ url: string }>(`/admin/coops/${selectedCoop.id}/billing/checkout`, {
        method: 'POST',
        body: { plan, billingPeriod },
      });
      window.location.href = result.url;
    } catch {
      // Error handled by api helper
    } finally {
      setCheckoutLoading(false);
    }
  };

  const handlePortal = async () => {
    if (!selectedCoop) return;
    setPortalLoading(true);
    try {
      const result = await api<{ url: string }>(`/admin/coops/${selectedCoop.id}/billing/portal`, {
        method: 'POST',
      });
      window.location.href = result.url;
    } catch {
      // Error handled by api helper
    } finally {
      setPortalLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!billing) return null;

  const trialDaysLeft = billing.trialEndsAt
    ? Math.max(0, Math.ceil((new Date(billing.trialEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : 0;

  const statusBadge = () => {
    if (billing.plan === 'FREE') {
      return <Badge className="bg-green-100 text-green-700">{t('planFree')}</Badge>;
    }
    if (billing.subscription?.status === 'ACTIVE') {
      return <Badge className="bg-green-100 text-green-700">{t('statusActive')}</Badge>;
    }
    if (trialDaysLeft > 0) {
      return <Badge className="bg-blue-100 text-blue-700">{t('statusTrial', { days: trialDaysLeft })}</Badge>;
    }
    if (billing.subscription?.status === 'PAST_DUE') {
      return <Badge variant="destructive">{t('statusPastDue')}</Badge>;
    }
    if (billing.isReadOnly) {
      return <Badge variant="destructive">{t('statusExpired')}</Badge>;
    }
    return <Badge variant="secondary">{billing.subscription?.status ?? t('statusNone')}</Badge>;
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t('title')}</h1>

      {success && (
        <Alert>
          <Check className="h-4 w-4" />
          <AlertDescription>{t('checkoutSuccess')}</AlertDescription>
        </Alert>
      )}

      {canceled && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{t('checkoutCanceled')}</AlertDescription>
        </Alert>
      )}

      {/* Current Plan */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            {t('currentPlan')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <span className="text-2xl font-bold">{billing.plan}</span>
            {statusBadge()}
          </div>

          {billing.trialEndsAt && trialDaysLeft > 0 && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              {t('trialEnds', { date: new Date(billing.trialEndsAt).toLocaleDateString() })}
            </div>
          )}

          {billing.subscription?.cancelAtPeriodEnd && (
            <Alert className="border-yellow-300 bg-yellow-50 text-yellow-800">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{t('cancelingAtPeriodEnd')}</AlertDescription>
            </Alert>
          )}

          {billing.subscription?.currentPeriodEnd && billing.subscription.status === 'ACTIVE' && (
            <p className="text-sm text-muted-foreground">
              {t('nextBilling', { date: new Date(billing.subscription.currentPeriodEnd).toLocaleDateString() })}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Subscribe or Manage */}
      {billing.plan !== 'FREE' && billing.subscription?.status !== 'ACTIVE' && (
        <Card>
          <CardHeader>
            <CardTitle>{t('subscribe')}</CardTitle>
            <CardDescription>{t('subscribeDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2">
              <Card className="border-2">
                <CardContent className="pt-6">
                  <h3 className="font-semibold mb-1">Essentials</h3>
                  <p className="text-sm text-muted-foreground mb-4">{t('essentialsDescription')}</p>
                  <div className="space-y-2">
                    <Button
                      className="w-full"
                      disabled={checkoutLoading}
                      onClick={() => handleCheckout('ESSENTIALS', 'YEARLY')}
                    >
                      {checkoutLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                      {t('subscribeYearly', { price: '390' })}
                    </Button>
                    <Button
                      variant="outline"
                      className="w-full"
                      disabled={checkoutLoading}
                      onClick={() => handleCheckout('ESSENTIALS', 'MONTHLY')}
                    >
                      {t('subscribeMonthly', { price: '39' })}
                    </Button>
                  </div>
                </CardContent>
              </Card>
              <Card className="border-2 border-primary">
                <CardContent className="pt-6">
                  <h3 className="font-semibold mb-1">Professional</h3>
                  <p className="text-sm text-muted-foreground mb-4">{t('professionalDescription')}</p>
                  <div className="space-y-2">
                    <Button
                      className="w-full"
                      disabled={checkoutLoading}
                      onClick={() => handleCheckout('PROFESSIONAL', 'YEARLY')}
                    >
                      {checkoutLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                      {t('subscribeYearly', { price: '890' })}
                    </Button>
                    <Button
                      variant="outline"
                      className="w-full"
                      disabled={checkoutLoading}
                      onClick={() => handleCheckout('PROFESSIONAL', 'MONTHLY')}
                    >
                      {t('subscribeMonthly', { price: '89' })}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Manage Billing (Stripe Portal) */}
      {billing.subscription && (
        <Card>
          <CardHeader>
            <CardTitle>{t('manageBilling')}</CardTitle>
            <CardDescription>{t('manageBillingDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={handlePortal} disabled={portalLoading} variant="outline">
              {portalLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              <ExternalLink className="h-4 w-4 mr-2" />
              {t('openBillingPortal')}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
