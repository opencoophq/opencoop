'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAdmin } from '@/contexts/admin-context';
import { Button } from '@/components/ui/button';
import { Download, FileText } from 'lucide-react';
import { apiFetch } from '@/lib/api';

interface ExportButtonsProps {
  reportType: string;
  params: Record<string, string>;
  disabled?: boolean;
  pdfSupported?: boolean;
}

export function ExportButtons({ reportType, params, disabled, pdfSupported = false }: ExportButtonsProps) {
  const t = useTranslations('reports');
  const { selectedCoop } = useAdmin();
  const [downloading, setDownloading] = useState<string | null>(null);

  const handleDownload = async (format: 'csv' | 'pdf') => {
    if (!selectedCoop) return;
    setDownloading(format);

    try {
      const queryString = new URLSearchParams(params).toString();
      const response = await apiFetch(
        `/admin/coops/${selectedCoop.id}/reports/${reportType}/${format}?${queryString}`,
      );

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${reportType}-${Date.now()}.${format}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
    } catch {
      // Silent failure - download just doesn't happen
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="flex gap-2">
      {pdfSupported && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleDownload('pdf')}
          disabled={disabled || downloading === 'pdf'}
        >
          <FileText className="h-4 w-4 mr-1" />
          {downloading === 'pdf' ? t('downloading') : t('exportPdf')}
        </Button>
      )}
      <Button
        variant="outline"
        size="sm"
        onClick={() => handleDownload('csv')}
        disabled={disabled || downloading === 'csv'}
      >
        <Download className="h-4 w-4 mr-1" />
        {downloading === 'csv' ? t('downloading') : t('exportCsv')}
      </Button>
    </div>
  );
}
