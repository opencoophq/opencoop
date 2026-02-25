'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAdmin } from '@/contexts/admin-context';
import { useLocale } from '@/contexts/locale-context';
import { api } from '@/lib/api';
import { formatCurrency } from '@opencoop/shared';
import { Card, CardContent } from '@/components/ui/card';
import { ReportFilters } from './report-filters';
import { ExportButtons } from './export-buttons';

interface Movement {
  date: string;
  type: string;
  shareholderName: string;
  shareClass: string;
  quantity: number;
  amount: number;
}

interface CapitalStatement {
  openingBalance: number;
  closingBalance: number;
  movements: Movement[];
}

export function CapitalStatementPreview() {
  const t = useTranslations('reports');
  const { selectedCoop } = useAdmin();
  const { locale } = useLocale();
  const now = new Date();
  const [from, setFrom] = useState(`${now.getFullYear()}-01-01`);
  const [to, setTo] = useState(now.toISOString().split('T')[0]);
  const [data, setData] = useState<CapitalStatement | null>(null);
  const [loading, setLoading] = useState(false);

  const generate = () => {
    if (!selectedCoop) return;
    setLoading(true);
    api<CapitalStatement>(`/admin/coops/${selectedCoop.id}/reports/capital-statement?from=${from}&to=${to}`)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  };

  const typeLabel = (type: string) => {
    const map: Record<string, string> = {
      PURCHASE: t('types.purchase'),
      SALE: t('types.sale'),
      TRANSFER_IN: t('types.transferIn'),
      TRANSFER_OUT: t('types.transferOut'),
    };
    return map[type] || type;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <ReportFilters type="dateRange" from={from} to={to} onFromChange={setFrom} onToChange={setTo} onGenerate={generate} loading={loading} />
        <ExportButtons reportType="capital-statement" params={{ from, to }} disabled={!data} pdfSupported />
      </div>

      {data && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Card>
              <CardContent className="pt-4">
                <p className="text-sm text-muted-foreground">{t('capitalStatement.openingBalance')}</p>
                <p className="text-xl font-bold">{formatCurrency(data.openingBalance, locale)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-sm text-muted-foreground">{t('capitalStatement.closingBalance')}</p>
                <p className="text-xl font-bold">{formatCurrency(data.closingBalance, locale)}</p>
              </CardContent>
            </Card>
          </div>

          {data.movements.length > 0 ? (
            <div className="border rounded-md overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">{t('capitalStatement.date')}</th>
                    <th className="text-left px-3 py-2 font-medium">{t('capitalStatement.type')}</th>
                    <th className="text-left px-3 py-2 font-medium">{t('capitalStatement.shareholder')}</th>
                    <th className="text-left px-3 py-2 font-medium">{t('capitalStatement.shareClass')}</th>
                    <th className="text-right px-3 py-2 font-medium">{t('capitalStatement.qty')}</th>
                    <th className="text-right px-3 py-2 font-medium">{t('capitalStatement.amount')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.movements.map((m, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-3 py-2">{new Date(m.date).toLocaleDateString(locale)}</td>
                      <td className="px-3 py-2">{typeLabel(m.type)}</td>
                      <td className="px-3 py-2">{m.shareholderName}</td>
                      <td className="px-3 py-2">{m.shareClass}</td>
                      <td className="px-3 py-2 text-right">{m.quantity}</td>
                      <td className="px-3 py-2 text-right">{formatCurrency(m.amount, locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t('noMovements')}</p>
          )}
        </div>
      )}
    </div>
  );
}
