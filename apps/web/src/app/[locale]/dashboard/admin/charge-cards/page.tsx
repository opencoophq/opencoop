'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';
import { useAdmin } from '@/contexts/admin-context';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatCurrency } from '@opencoop/shared';
import { Loader2 } from 'lucide-react';

type CardStatus = 'REQUESTED' | 'PAID' | 'ACTIVE' | 'BLOCKED' | 'CANCELLED';
type Filter = 'ALL' | CardStatus | 'TODO';
type AdminAction = 'block' | 'unblock' | 'mark-lost' | 'provider-sync-done' | 'cancel';

const FILTERS: Filter[] = ['ALL', 'REQUESTED', 'PAID', 'ACTIVE', 'BLOCKED', 'CANCELLED', 'TODO'];

interface AdminChargeCard {
  id: string;
  label: string | null;
  status: CardStatus;
  blockReason: 'NO_SHARES' | 'LOST' | 'ADMIN' | null;
  ogmCode: string;
  cardNumber: string | null;
  feeInclVat: number;
  isReplacement: boolean;
  providerSyncNeeded: boolean;
  shareholderName: string;
  totalPaid: number;
  waitingWorkingDays: number | null;
  overdue: boolean;
}

function queryFor(filter: Filter): string {
  if (filter === 'ALL') return '';
  if (filter === 'TODO') return '?todo=true';
  return `?status=${filter}`;
}

export default function AdminChargeCardsPage() {
  const t = useTranslations('chargeCards');
  const { locale } = useLocale();
  const { selectedCoop } = useAdmin();
  const [filter, setFilter] = useState<Filter>('ALL');
  const [cards, setCards] = useState<AdminChargeCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [issuing, setIssuing] = useState<AdminChargeCard | null>(null);
  const [cardNumber, setCardNumber] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!selectedCoop) return;
    setLoading(true);
    try {
      setCards(await api<AdminChargeCard[]>(`/admin/coops/${selectedCoop.id}/charge-cards${queryFor(filter)}`));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('actionError'));
    } finally {
      setLoading(false);
    }
  }, [selectedCoop, filter, t]);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (card: AdminChargeCard, action: AdminAction) => {
    if (!selectedCoop) return;
    // A cancel on a card that already holds a payment doesn't refund it:
    // the coop must do that by hand outside OpenCoop. Warn before letting
    // the admin cancel that one; every other action keeps the plain confirm.
    const confirmMessage = action === 'cancel' && card.totalPaid > 0 ? t('admin.cancelPaidConfirm') : t('admin.confirm');
    if (!window.confirm(confirmMessage)) return;
    setBusy(true);
    try {
      await api(`/admin/coops/${selectedCoop.id}/charge-cards/${card.id}/${action}`, { method: 'POST' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('actionError'));
    } finally {
      setBusy(false);
    }
  };

  const submitIssue = async () => {
    if (!selectedCoop || !issuing) return;
    setBusy(true);
    try {
      await api(`/admin/coops/${selectedCoop.id}/charge-cards/${issuing.id}/issue`, {
        method: 'POST',
        body: { cardNumber },
      });
      setIssuing(null);
      setCardNumber('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('actionError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('admin.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('admin.subtitle')}</p>
        </div>
        <div className="w-64 space-y-1">
          <Label>{t('admin.filterLabel')}</Label>
          <Select value={filter} onValueChange={(value) => setFilter(value as Filter)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FILTERS.map((f) => (
                <SelectItem key={f} value={f}>
                  {t(`admin.filter.${f}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : cards.length === 0 ? (
            <p className="py-12 text-center text-muted-foreground">{t('admin.empty')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('admin.shareholder')}</TableHead>
                  <TableHead>{t('admin.label')}</TableHead>
                  <TableHead>{t('admin.status')}</TableHead>
                  <TableHead>{t('admin.ogm')}</TableHead>
                  <TableHead className="text-right">{t('admin.fee')}</TableHead>
                  <TableHead className="text-right">{t('admin.paid')}</TableHead>
                  <TableHead>{t('admin.cardNumber')}</TableHead>
                  <TableHead>{t('admin.waiting')}</TableHead>
                  <TableHead>{t('admin.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cards.map((card) => (
                  <TableRow key={card.id} className={card.overdue ? 'bg-red-50 dark:bg-red-950/30' : undefined}>
                    <TableCell className="font-medium">{card.shareholderName}</TableCell>
                    <TableCell>
                      {card.label || '—'}
                      {card.isReplacement && (
                        <Badge variant="outline" className="ml-2">
                          {t('replacement')}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        <Badge
                          variant={card.status === 'BLOCKED' ? 'destructive' : card.status === 'ACTIVE' ? 'default' : 'secondary'}
                        >
                          {t(`status.${card.status}`)}
                          {card.blockReason ? ` · ${t(`blockReason.${card.blockReason}`)}` : ''}
                        </Badge>
                        {card.providerSyncNeeded && <Badge variant="outline">{t('admin.todo')}</Badge>}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{card.ogmCode}</TableCell>
                    <TableCell className="text-right">{formatCurrency(card.feeInclVat, locale)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(card.totalPaid, locale)}</TableCell>
                    <TableCell className="font-mono text-xs">{card.cardNumber ?? '—'}</TableCell>
                    <TableCell>
                      {card.waitingWorkingDays === null ? (
                        '—'
                      ) : (
                        <span className={card.overdue ? 'font-medium text-red-700 dark:text-red-400' : undefined}>
                          {t('admin.workingDays', { days: card.waitingWorkingDays })}
                          {card.overdue ? ` · ${t('admin.overdue')}` : ''}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {card.status === 'PAID' && (
                          <Button
                            size="sm"
                            disabled={busy}
                            onClick={() => {
                              setIssuing(card);
                              setCardNumber('');
                            }}
                          >
                            {t('admin.issue')}
                          </Button>
                        )}
                        {card.status === 'ACTIVE' && (
                          <Button size="sm" variant="outline" disabled={busy} onClick={() => act(card, 'block')}>
                            {t('admin.block')}
                          </Button>
                        )}
                        {card.status === 'BLOCKED' && card.blockReason === 'ADMIN' && (
                          <Button size="sm" variant="outline" disabled={busy} onClick={() => act(card, 'unblock')}>
                            {t('admin.unblock')}
                          </Button>
                        )}
                        {(card.status === 'ACTIVE' || (card.status === 'BLOCKED' && card.blockReason !== 'LOST')) && (
                          <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(card, 'mark-lost')}>
                            {t('admin.markLost')}
                          </Button>
                        )}
                        {(card.status === 'REQUESTED' || card.status === 'PAID') && (
                          <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(card, 'cancel')}>
                            {t('admin.cancel')}
                          </Button>
                        )}
                        {card.providerSyncNeeded && (
                          <Button size="sm" variant="secondary" disabled={busy} onClick={() => act(card, 'provider-sync-done')}>
                            {t('admin.syncDone')}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={issuing !== null} onOpenChange={(open) => !open && setIssuing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.issueTitle')}</DialogTitle>
            <DialogDescription>{t('admin.issueDescription')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="charge-card-number">{t('admin.cardNumber')}</Label>
            <Input
              id="charge-card-number"
              maxLength={64}
              value={cardNumber}
              onChange={(e) => setCardNumber(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button onClick={submitIssue} disabled={busy || cardNumber.trim() === ''}>
              {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t('admin.issueSubmit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
