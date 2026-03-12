'use client';

import { useEffect, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { useAdmin } from '@/contexts/admin-context';
import { useLocale } from '@/contexts/locale-context';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { formatCurrency } from '@opencoop/shared';
import { Upload, Link2 } from 'lucide-react';

const BANK_PRESETS = [
  { id: 'belfius', name: 'Belfius' },
  { id: 'kbc', name: 'KBC' },
  { id: 'bnp', name: 'BNP Paribas Fortis' },
  { id: 'ing', name: 'ING' },
  { id: 'generic', name: 'Generic CSV' },
] as const;

interface MatchedShareholder {
  firstName?: string;
  lastName?: string;
}

interface MatchedRegistration {
  shareholder?: MatchedShareholder;
}

interface MatchedPayment {
  registration?: MatchedRegistration;
}

interface BankTx {
  id: string;
  date: string;
  amount: number;
  counterparty: string | null;
  ogmCode: string | null;
  referenceText: string | null;
  matchStatus: string;
  matchedPayment?: MatchedPayment | null;
}

interface Registration {
  id: string;
  ogmCode: string | null;
  totalAmount: number;
  status: string;
  type: string;
  shareholder: {
    firstName: string | null;
    lastName: string | null;
    companyName: string | null;
  };
}

export default function BankImportPage() {
  const t = useTranslations();
  const { selectedCoop } = useAdmin();
  const { locale } = useLocale();
  const [transactions, setTransactions] = useState<BankTx[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState('belfius');
  const [matchDialogOpen, setMatchDialogOpen] = useState(false);
  const [matchingTx, setMatchingTx] = useState<BankTx | null>(null);
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [loadingRegistrations, setLoadingRegistrations] = useState(false);
  const [matching, setMatching] = useState(false);

  const loadData = useCallback(async () => {
    if (!selectedCoop) return;
    setLoading(true);
    try {
      const data = await api<BankTx[]>(`/admin/coops/${selectedCoop.id}/bank-transactions`);
      setTransactions(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [selectedCoop]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedCoop) return;
    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    try {
      await api(`/admin/coops/${selectedCoop.id}/bank-import?preset=${selectedPreset}`, {
        method: 'POST',
        body: formData,
      });
      loadData();
    } catch {
      // ignore
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const openMatchDialog = async (tx: BankTx) => {
    setMatchingTx(tx);
    setMatchDialogOpen(true);
    setLoadingRegistrations(true);
    try {
      const data = await api<{ data: Registration[] }>(
        `/admin/coops/${selectedCoop!.id}/registrations?status=PENDING_PAYMENT&pageSize=100`,
      );
      setRegistrations(data.data || []);
    } catch {
      setRegistrations([]);
    } finally {
      setLoadingRegistrations(false);
    }
  };

  const handleMatch = async (registrationId: string) => {
    if (!matchingTx || !selectedCoop) return;
    setMatching(true);
    try {
      await api(`/admin/coops/${selectedCoop.id}/bank-transactions/${matchingTx.id}/match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ registrationId }),
      });
      setMatchDialogOpen(false);
      setMatchingTx(null);
      loadData();
    } catch {
      // ignore
    } finally {
      setMatching(false);
    }
  };

  if (!selectedCoop) return <p className="text-muted-foreground">{t('admin.selectCoop')}</p>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t('admin.bankImport.title')}</h1>
        <div className="flex items-center gap-3">
          <Select value={selectedPreset} onValueChange={setSelectedPreset}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder={t('admin.bankImport.selectBank')} />
            </SelectTrigger>
            <SelectContent>
              {BANK_PRESETS.map((preset) => (
                <SelectItem key={preset.id} value={preset.id}>
                  {preset.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="file"
            accept=".csv"
            onChange={handleUpload}
            className="hidden"
            id="csv-upload"
          />
          <Button asChild disabled={uploading}>
            <label htmlFor="csv-upload" className="cursor-pointer">
              <Upload className="h-4 w-4 mr-2" />
              {uploading ? t('common.loading') : t('admin.bankImport.upload')}
            </label>
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : transactions.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">{t('common.noResults')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('common.date')}</TableHead>
                  <TableHead className="text-right">{t('common.amount')}</TableHead>
                  <TableHead>{t('admin.bankImport.counterparty')}</TableHead>
                  <TableHead>{t('payments.ogmCode')}</TableHead>
                  <TableHead>{t('common.status')}</TableHead>
                  <TableHead>{t('admin.bankImport.matchedTo')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map((tx) => {
                  const shareholder = tx.matchedPayment?.registration?.shareholder;
                  const matchedName = shareholder
                    ? `${shareholder.firstName || ''} ${shareholder.lastName || ''}`.trim()
                    : null;

                  return (
                    <TableRow key={tx.id}>
                      <TableCell>{new Date(tx.date).toLocaleDateString(locale)}</TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(Number(tx.amount), locale)}
                      </TableCell>
                      <TableCell>{tx.counterparty || '-'}</TableCell>
                      <TableCell className="font-mono text-sm">{tx.ogmCode || '-'}</TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            tx.matchStatus === 'UNMATCHED'
                              ? 'destructive'
                              : tx.matchStatus === 'AUTO_MATCHED'
                                ? 'default'
                                : 'secondary'
                          }
                        >
                          {tx.matchStatus}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {matchedName ? (
                          matchedName
                        ) : tx.matchStatus === 'UNMATCHED' && Number(tx.amount) > 0 ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openMatchDialog(tx)}
                          >
                            <Link2 className="h-4 w-4 mr-1" />
                            {t('admin.bankImport.match')}
                          </Button>
                        ) : (
                          '-'
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={matchDialogOpen} onOpenChange={setMatchDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('admin.bankImport.matchTransaction')}</DialogTitle>
          </DialogHeader>
          {matchingTx && (
            <div className="space-y-4">
              <div className="rounded-md bg-muted p-3 text-sm space-y-1">
                <p>
                  <span className="font-medium">{t('common.amount')}:</span>{' '}
                  {formatCurrency(Number(matchingTx.amount), locale)}
                </p>
                <p>
                  <span className="font-medium">{t('common.date')}:</span>{' '}
                  {new Date(matchingTx.date).toLocaleDateString(locale)}
                </p>
                {matchingTx.counterparty && (
                  <p>
                    <span className="font-medium">{t('admin.bankImport.counterparty')}:</span>{' '}
                    {matchingTx.counterparty}
                  </p>
                )}
                {matchingTx.referenceText && (
                  <p>
                    <span className="font-medium">{t('admin.bankImport.reference')}:</span>{' '}
                    {matchingTx.referenceText}
                  </p>
                )}
              </div>

              <div>
                <h4 className="text-sm font-medium mb-2">
                  {t('admin.bankImport.selectRegistration')}
                </h4>
                {loadingRegistrations ? (
                  <div className="flex justify-center py-4">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
                  </div>
                ) : registrations.length === 0 ? (
                  <p className="text-muted-foreground text-sm py-4">
                    {t('admin.bankImport.noRegistrations')}
                  </p>
                ) : (
                  <div className="max-h-60 overflow-y-auto space-y-1">
                    {registrations.map((reg) => {
                      const name = reg.shareholder.companyName
                        || `${reg.shareholder.firstName || ''} ${reg.shareholder.lastName || ''}`.trim();
                      return (
                        <button
                          key={reg.id}
                          className="w-full flex items-center justify-between rounded-md border p-3 text-sm hover:bg-accent transition-colors disabled:opacity-50"
                          onClick={() => handleMatch(reg.id)}
                          disabled={matching}
                        >
                          <div className="text-left">
                            <p className="font-medium">{name}</p>
                            {reg.ogmCode && (
                              <p className="text-muted-foreground font-mono text-xs">
                                {reg.ogmCode}
                              </p>
                            )}
                          </div>
                          <div className="text-right">
                            <p>{formatCurrency(Number(reg.totalAmount), locale)}</p>
                            <p className="text-muted-foreground text-xs">{reg.type}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
