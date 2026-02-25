'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAdmin } from '@/contexts/admin-context';
import { useLocale } from '@/contexts/locale-context';
import { api } from '@/lib/api';
import { formatCurrency } from '@opencoop/shared';
import { ReportFilters } from './report-filters';
import { ExportButtons } from './export-buttons';

interface ShareholderEntry {
  name: string;
  type: string;
  email: string | null;
  status: string;
  shareCount: number;
  totalValue: number;
  joinDate: string;
}

interface ShareholderRegister {
  shareholders: ShareholderEntry[];
}

export function ShareholderRegisterPreview() {
  const t = useTranslations('reports');
  const { selectedCoop } = useAdmin();
  const { locale } = useLocale();
  const [data, setData] = useState<ShareholderRegister | null>(null);
  const [loading, setLoading] = useState(false);

  const generate = () => {
    if (!selectedCoop) return;
    setLoading(true);
    api<ShareholderRegister>(`/admin/coops/${selectedCoop.id}/reports/shareholder-register`)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  };

  const typeLabel = (type: string) => {
    const map: Record<string, string> = {
      INDIVIDUAL: t('shareholderTypes.individual'),
      COMPANY: t('shareholderTypes.company'),
      MINOR: t('shareholderTypes.minor'),
    };
    return map[type] || type;
  };

  const totalShares = data?.shareholders.reduce((sum, s) => sum + s.shareCount, 0) ?? 0;
  const totalValue = data?.shareholders.reduce((sum, s) => sum + s.totalValue, 0) ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <ReportFilters type="none" onGenerate={generate} loading={loading} />
        <ExportButtons reportType="shareholder-register" params={{}} disabled={!data} />
      </div>

      {data && (
        <div className="border rounded-md overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-3 py-2 font-medium">{t('shareholderRegister.name')}</th>
                <th className="text-left px-3 py-2 font-medium">{t('shareholderRegister.type')}</th>
                <th className="text-left px-3 py-2 font-medium">{t('shareholderRegister.email')}</th>
                <th className="text-right px-3 py-2 font-medium">{t('shareholderRegister.shares')}</th>
                <th className="text-right px-3 py-2 font-medium">{t('shareholderRegister.value')}</th>
                <th className="text-left px-3 py-2 font-medium">{t('shareholderRegister.memberSince')}</th>
              </tr>
            </thead>
            <tbody>
              {data.shareholders.map((sh, i) => (
                <tr key={i} className="border-t">
                  <td className="px-3 py-2 font-medium">{sh.name}</td>
                  <td className="px-3 py-2">{typeLabel(sh.type)}</td>
                  <td className="px-3 py-2 text-muted-foreground">{sh.email || '-'}</td>
                  <td className="px-3 py-2 text-right">{sh.shareCount}</td>
                  <td className="px-3 py-2 text-right">{formatCurrency(sh.totalValue, locale)}</td>
                  <td className="px-3 py-2">{new Date(sh.joinDate).toLocaleDateString(locale)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-muted/50 font-medium">
              <tr className="border-t">
                <td className="px-3 py-2" colSpan={3}>{t('shareholderRegister.total')} ({data.shareholders.length})</td>
                <td className="px-3 py-2 text-right">{totalShares}</td>
                <td className="px-3 py-2 text-right">{formatCurrency(totalValue, locale)}</td>
                <td className="px-3 py-2"></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
