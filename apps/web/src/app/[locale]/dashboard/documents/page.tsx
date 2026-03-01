'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useLocale } from '@/contexts/locale-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api, apiFetch } from '@/lib/api';
import { Download, FilePlus, Loader2 } from 'lucide-react';

interface DocumentData {
  id: string;
  type: string;
  filePath: string;
  generatedAt: string;
}

export default function DocumentsPage() {
  const t = useTranslations();
  const { locale } = useLocale();
  const [documents, setDocuments] = useState<DocumentData[]>([]);
  const [loading, setLoading] = useState(true);
  const [shareholderId, setShareholderId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    async function loadData() {
      try {
        const profile = await api<{ shareholders: Array<{ id: string; documents: DocumentData[] }> }>('/auth/me');
        if (profile.shareholders?.[0]) {
          setShareholderId(profile.shareholders[0].id);
          setDocuments(profile.shareholders[0].documents || []);
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  const handleDownload = async (doc: DocumentData) => {
    if (!shareholderId) return;
    setDownloadError(null);
    try {
      const response = await apiFetch(
        `/shareholders/${shareholderId}/documents/${doc.id}/download`,
      );
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.filePath.split('/').pop() || 'document.pdf';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
    } catch {
      setDownloadError(t('personalData.downloadError'));
    }
  };

  const handleGenerateCertificate = async () => {
    if (!shareholderId) return;
    setGenerating(true);
    setDownloadError(null);
    try {
      const doc = await api<DocumentData>(`/shareholders/${shareholderId}/generate-certificate`, {
        method: 'POST',
        body: { locale: locale.split('-')[0] },
      });
      setDocuments((prev) => [doc, ...prev]);
    } catch {
      setDownloadError(t('common.error'));
    } finally {
      setGenerating(false);
    }
  };

  const typeLabel = (type: string) => {
    const labels: Record<string, string> = {
      SHARE_CERTIFICATE: t('common.certificate'),
      PURCHASE_STATEMENT: t('transactions.types.PURCHASE'),
      DIVIDEND_STATEMENT: t('dividends.statement'),
      TRANSACTION_REPORT: t('transactions.title'),
    };
    return labels[type] || type;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t('common.documents')}</h1>
        {shareholderId && (
          <Button onClick={handleGenerateCertificate} disabled={generating}>
            {generating ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <FilePlus className="h-4 w-4 mr-2" />
            )}
            {generating ? t('personalData.generating') : t('personalData.generateCertificate')}
          </Button>
        )}
      </div>

      {downloadError && (
        <div className="mb-4 p-3 bg-destructive/10 text-destructive text-sm rounded-md">
          {downloadError}
        </div>
      )}

      <Card>
        <CardContent className="pt-6">
          {documents.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">{t('common.noResults')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('common.type')}</TableHead>
                  <TableHead>{t('common.date')}</TableHead>
                  <TableHead className="text-right">{t('common.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {documents.map((doc) => (
                  <TableRow key={doc.id}>
                    <TableCell>
                      <Badge variant="outline">{typeLabel(doc.type)}</Badge>
                    </TableCell>
                    <TableCell>
                      {new Date(doc.generatedAt).toLocaleDateString(locale)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => handleDownload(doc)}>
                        <Download className="h-4 w-4 mr-1" />
                        {t('common.download')}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
