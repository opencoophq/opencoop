'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { api } from '@/lib/api';
import { useLocale } from '@/contexts/locale-context';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EpcQrCode } from '@/components/epc-qr-code';
import { formatCurrency, formatIban } from '@opencoop/shared';
import { Loader2, Plus } from 'lucide-react';

type CardStatus = 'REQUESTED' | 'PAID' | 'ACTIVE' | 'BLOCKED' | 'CANCELLED';
type BlockReason = 'NO_SHARES' | 'LOST' | 'ADMIN';
type CardAction = 'cancel' | 'report-lost' | 'request-reenable';

interface ChargeCardView {
  id: string;
  label: string | null;
  status: CardStatus;
  blockReason: BlockReason | null;
  ogmCode: string;
  cardNumber: string | null;
  // Decimal columns travel over the wire as JSON strings in some responses;
  // parse with `money()` below before formatting, never format directly.
  feeInclVat: number | string;
  isReplacement: boolean;
  replaced: boolean;
  providerSyncNeeded: boolean;
  requestedAt: string;
}

interface NextRequestTerms {
  feeInclVat: number | string;
  isReplacement: boolean;
}

interface Overview {
  enabled: boolean;
  coop: { name: string; slug: string; bankIban: string | null; bankBic: string | null };
  shareholderStatus: 'PENDING' | 'ACTIVE' | 'INACTIVE';
  fee: number | string;
  replacementFee: number | string;
  // Computed server-side with the same rule the request endpoint uses, so the
  // dialog never quotes a fee the server would not actually charge.
  nextRequest: NextRequestTerms | null;
  cards: ChargeCardView[];
}

interface PaymentDetails {
  beneficiaryName: string;
  iban: string | null;
  bic: string | null;
  amount: number | string;
  ogmCode: string;
}

/** Decimal fields (fees, amounts) arrive as JSON strings; coerce before formatting. */
const money = (value: number | string): number => Number(value);

export default function ChargeCardsPage() {
  const t = useTranslations('chargeCards');
  const { locale } = useLocale();
  const [shareholderId, setShareholderId] = useState<string | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [requestOpen, setRequestOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [payment, setPayment] = useState<PaymentDetails | null>(null);

  const load = useCallback(async (id: string) => {
    setOverview(await api<Overview>(`/shareholders/${id}/charge-cards`));
  }, []);

  useEffect(() => {
    api<{ shareholders?: Array<{ id: string }> }>('/auth/me')
      .then(async (profile) => {
        // Same convention as the other dashboard pages: the first shareholder record.
        const id = profile.shareholders?.[0]?.id ?? null;
        setShareholderId(id);
        if (id) await load(id);
      })
      .catch(() => setError(t('actionError')))
      .finally(() => setLoading(false));
  }, [load, t]);

  const paymentFor = (card: ChargeCardView): PaymentDetails | null =>
    overview
      ? {
          beneficiaryName: overview.coop.name,
          iban: overview.coop.bankIban,
          bic: overview.coop.bankBic,
          amount: card.feeInclVat,
          ogmCode: card.ogmCode,
        }
      : null;

  // The API returns its own message for refusals (409 payment held, 400 wrong
  // status, ...); show it verbatim instead of a generic error.
  const messageFor = (err: unknown): string => (err instanceof Error && err.message ? err.message : t('actionError'));

  const runAction = async (cardId: string, action: CardAction, confirmText: string) => {
    if (!shareholderId || !window.confirm(confirmText)) return;
    setError(null);
    setNotice(null);
    try {
      await api(`/shareholders/${shareholderId}/charge-cards/${cardId}/${action}`, { method: 'POST' });
      if (action === 'request-reenable') setNotice(t('reenableRequested'));
      await load(shareholderId);
    } catch (err) {
      setError(messageFor(err));
    }
  };

  const submitRequest = async () => {
    if (!shareholderId) return;
    setSubmitting(true);
    setError(null);
    try {
      // The server decides whether this becomes a replacement for a lost card
      // (at the replacement fee); the UI has a single request action.
      const result = await api<{ card: ChargeCardView; payment: PaymentDetails }>(
        `/shareholders/${shareholderId}/charge-cards`,
        { method: 'POST', body: { label: label.trim() || undefined } },
      );
      setRequestOpen(false);
      setLabel('');
      setPayment(result.payment);
      await load(shareholderId);
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!shareholderId || !overview) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">{error ?? t('noShareholder')}</CardContent>
      </Card>
    );
  }

  // The feature can be switched off after cards already exist: a holder must
  // still see those cards (e.g. to report one lost), just without the
  // ability to request a new one. Only show the disabled placeholder when
  // there is nothing to see.
  if (!overview.enabled && overview.cards.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">{t('notEnabled')}</CardContent>
      </Card>
    );
  }

  const isActive = overview.shareholderStatus === 'ACTIVE';
  // Fall back to the regular fee/non-replacement if the preview is somehow
  // missing (e.g. an older cached response); the server still decides for real.
  const nextRequest = overview.nextRequest ?? { feeInclVat: overview.fee, isReplacement: false };
  const nextFee = formatCurrency(money(nextRequest.feeInclVat), locale);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        {overview.enabled && (
          <Button onClick={() => setRequestOpen(true)} disabled={!isActive}>
            <Plus className="h-4 w-4 mr-2" />
            {t('request')}
          </Button>
        )}
      </div>

      {!isActive && (
        <Alert>
          <AlertDescription className="flex flex-wrap items-center gap-2">
            <span>{t('notActive')}</span>
            <Link href={`/${overview.coop.slug}/register`} className="font-medium underline">
              {t('becomeShareholder')}
            </Link>
          </AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {notice && (
        <Alert>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}

      {overview.cards.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">{t('empty')}</CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {overview.cards.map((card) => (
            <Card key={card.id} data-testid="charge-card">
              <CardContent className="pt-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold">{card.label || t('untitled')}</h2>
                    <Badge
                      variant={card.status === 'ACTIVE' ? 'default' : card.status === 'BLOCKED' ? 'destructive' : 'secondary'}
                    >
                      {t(`status.${card.status}`)}
                      {card.blockReason ? ` · ${t(`blockReason.${card.blockReason}`)}` : ''}
                    </Badge>
                    {card.isReplacement && <Badge variant="outline">{t('replacement')}</Badge>}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {t('requestedOn', { date: new Date(card.requestedAt).toLocaleDateString(locale) })} · {t('fee')}:{' '}
                    {formatCurrency(money(card.feeInclVat), locale)}
                  </p>
                  {card.cardNumber && (
                    <p className="text-sm">
                      {t('cardNumber')}: <span className="font-mono">{card.cardNumber}</span>
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {card.status === 'REQUESTED' && (
                    <>
                      <Button variant="outline" size="sm" onClick={() => setPayment(paymentFor(card))}>
                        {t('showPayment')}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => runAction(card.id, 'cancel', t('cancelConfirm'))}>
                        {t('cancel')}
                      </Button>
                    </>
                  )}
                  {card.status === 'ACTIVE' && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={card.providerSyncNeeded}
                      onClick={() => runAction(card.id, 'request-reenable', t('reenableConfirm'))}
                    >
                      {t('reenable')}
                    </Button>
                  )}
                  {(card.status === 'ACTIVE' || (card.status === 'BLOCKED' && card.blockReason !== 'LOST')) && (
                    <Button variant="ghost" size="sm" onClick={() => runAction(card.id, 'report-lost', t('reportLostConfirm'))}>
                      {t('reportLost')}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={requestOpen} onOpenChange={setRequestOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('requestTitle')}</DialogTitle>
            <DialogDescription>
              {t(nextRequest.isReplacement ? 'replacementDescription' : 'requestDescription', { fee: nextFee })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="charge-card-label">{t('label')}</Label>
              <Input
                id="charge-card-label"
                maxLength={60}
                value={label}
                placeholder={t('labelPlaceholder')}
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={submitRequest} disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t('submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={payment !== null} onOpenChange={(open) => !open && setPayment(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('payTitle')}</DialogTitle>
            <DialogDescription>{t('payDescription')}</DialogDescription>
          </DialogHeader>
          {payment && (
            <div className="space-y-4">
              {payment.iban && (
                <div className="flex justify-center">
                  <EpcQrCode
                    bic={payment.bic ?? undefined}
                    beneficiaryName={payment.beneficiaryName}
                    iban={payment.iban}
                    amount={money(payment.amount)}
                    reference={payment.ogmCode}
                    label={t('payTitle')}
                  />
                </div>
              )}
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">{t('beneficiary')}</dt>
                  <dd className="font-medium">{payment.beneficiaryName}</dd>
                </div>
                {payment.iban && (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">IBAN</dt>
                    <dd className="font-mono text-xs">{formatIban(payment.iban)}</dd>
                  </div>
                )}
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">{t('amount')}</dt>
                  <dd className="font-medium">{formatCurrency(money(payment.amount), locale)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">{t('ogm')}</dt>
                  <dd className="font-mono text-xs" data-testid="charge-card-ogm">
                    {payment.ogmCode}
                  </dd>
                </div>
              </dl>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayment(null)}>
              {t('close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
