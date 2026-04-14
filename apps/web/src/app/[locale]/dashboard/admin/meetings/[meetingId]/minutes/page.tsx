'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { api, apiFetch } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useAdmin } from '@/contexts/admin-context';
import { useLocale } from '@/contexts/locale-context';
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Download,
  FileText,
  Upload,
} from 'lucide-react';
import type { MeetingDto, MeetingMinutesDto } from '@opencoop/shared';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export default function MinutesPage() {
  const t = useTranslations();
  const params = useParams();
  const meetingId = (params?.meetingId as string) || '';
  const { selectedCoop } = useAdmin();
  const { locale } = useLocale();

  const [meeting, setMeeting] = useState<MeetingDto | null>(null);
  const [minutes, setMinutes] = useState<MeetingMinutesDto | null>(null);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [finalizing, setFinalizing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [signedByName, setSignedByName] = useState('');

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const fetchAll = useCallback(async () => {
    if (!selectedCoop || !meetingId) return;
    setLoading(true);
    try {
      const m = await api<MeetingDto>(
        `/admin/coops/${selectedCoop.id}/meetings/${meetingId}`,
      );
      setMeeting(m);
      try {
        const min = await api<MeetingMinutesDto | null>(
          `/admin/coops/${selectedCoop.id}/meetings/${meetingId}/minutes`,
        );
        setMinutes(min);
        setContent(min?.content ?? '');
      } catch {
        setMinutes(null);
        setContent('');
      }
      setError(null);
    } catch {
      setError(t('meetings.detail.loadError'));
    } finally {
      setLoading(false);
    }
  }, [selectedCoop, meetingId, t]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const generateDraft = async () => {
    if (!selectedCoop) return;
    setGenerating(true);
    setError(null);
    try {
      await api(
        `/admin/coops/${selectedCoop.id}/meetings/${meetingId}/minutes/generate`,
        { method: 'POST' },
      );
      await fetchAll();
    } catch {
      setError(t('meetings.minutes.generateError'));
    } finally {
      setGenerating(false);
    }
  };

  const saveMinutes = async () => {
    if (!selectedCoop) return;
    setSaveState('saving');
    setError(null);
    try {
      await api(
        `/admin/coops/${selectedCoop.id}/meetings/${meetingId}/minutes`,
        { method: 'PATCH', body: { content } },
      );
      setSaveState('saved');
      setTimeout(
        () => setSaveState((s) => (s === 'saved' ? 'idle' : s)),
        2000,
      );
    } catch {
      setSaveState('error');
      setError(t('meetings.minutes.saveError'));
    }
  };

  const finalizeMinutes = async () => {
    if (!selectedCoop) return;
    setFinalizing(true);
    setError(null);
    try {
      await api(
        `/admin/coops/${selectedCoop.id}/meetings/${meetingId}/minutes/finalize`,
        { method: 'POST' },
      );
      await fetchAll();
    } catch {
      setError(t('meetings.minutes.finalizeError'));
    } finally {
      setFinalizing(false);
    }
  };

  const downloadPdf = async () => {
    if (!selectedCoop) return;
    try {
      const response = await apiFetch(
        `/admin/coops/${selectedCoop.id}/meetings/${meetingId}/minutes/pdf`,
      );
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch {
      setError(t('meetings.minutes.downloadError'));
    }
  };

  const uploadSigned = async () => {
    if (!selectedCoop || !fileInputRef.current?.files?.[0]) {
      setError(t('meetings.minutes.fileRequired'));
      return;
    }
    const file = fileInputRef.current.files[0];
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('signedByName', signedByName.trim());
      await apiFetch(
        `/admin/coops/${selectedCoop.id}/meetings/${meetingId}/minutes/upload-signed`,
        { method: 'POST', body: fd },
      );
      if (fileInputRef.current) fileInputRef.current.value = '';
      setSignedByName('');
      await fetchAll();
    } catch {
      setError(t('meetings.minutes.uploadError'));
    } finally {
      setUploading(false);
    }
  };

  if (!selectedCoop) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">{t('admin.selectCoop')}</p>
      </div>
    );
  }

  if (loading || !meeting) {
    return (
      <div className="space-y-6">
        <div className="animate-pulse h-8 w-64 bg-muted rounded" />
        <div className="animate-pulse h-40 bg-muted rounded-lg" />
      </div>
    );
  }

  const formatDate = (iso?: string | null) =>
    iso ? new Date(iso).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }) : '';

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/dashboard/admin/meetings/${meeting.id}`}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            {t('meetings.detail.backToList')}
          </Link>
        </Button>
      </div>

      <div>
        <h1 className="text-2xl font-bold">{t('meetings.minutes.heading')}</h1>
        <p className="text-sm text-muted-foreground">{meeting.title}</p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {!minutes ? (
        <Card>
          <CardContent className="py-12 text-center space-y-4">
            <FileText className="h-12 w-12 mx-auto text-muted-foreground" />
            <p className="text-muted-foreground">{t('meetings.minutes.empty')}</p>
            <Button onClick={generateDraft} disabled={generating}>
              {generating
                ? t('common.loading')
                : t('meetings.minutes.generateDraft')}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {t('meetings.minutes.heading')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Textarea
                rows={20}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="font-mono text-sm"
              />
              <div className="flex items-center gap-2 flex-wrap">
                <Button onClick={saveMinutes} disabled={saveState === 'saving'}>
                  {saveState === 'saving' && t('meetings.minutes.saving')}
                  {saveState === 'saved' && (
                    <>
                      <Check className="h-4 w-4 mr-2" />
                      {t('meetings.minutes.saved')}
                    </>
                  )}
                  {(saveState === 'idle' || saveState === 'error') &&
                    t('meetings.minutes.save')}
                </Button>
                <Button variant="outline" onClick={downloadPdf}>
                  <Download className="h-4 w-4 mr-2" />
                  {t('meetings.minutes.downloadPdf')}
                </Button>
                <Button
                  variant="secondary"
                  onClick={finalizeMinutes}
                  disabled={finalizing}
                >
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  {finalizing ? t('common.loading') : t('meetings.minutes.finalize')}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {t('meetings.minutes.uploadSigned')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {minutes.signedPdfUrl ? (
                <div className="space-y-2">
                  <a
                    href={minutes.signedPdfUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary hover:underline inline-flex items-center gap-2"
                  >
                    <Download className="h-4 w-4" />
                    {t('meetings.minutes.download')}
                  </a>
                  {minutes.signedAt && (
                    <p className="text-sm text-muted-foreground">
                      {t('meetings.minutes.signedAt')}: {formatDate(minutes.signedAt)}
                    </p>
                  )}
                  {minutes.signedByName && (
                    <p className="text-sm text-muted-foreground">
                      {t('meetings.minutes.signedBy')}: {minutes.signedByName}
                    </p>
                  )}
                </div>
              ) : null}

              <div className="space-y-2">
                <Label>{t('meetings.minutes.signedByNameLabel')}</Label>
                <Input
                  value={signedByName}
                  onChange={(e) => setSignedByName(e.target.value)}
                  placeholder="Jan Janssens"
                />
              </div>
              <div className="space-y-2">
                <Label>PDF</Label>
                <Input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf"
                />
              </div>
              <Button onClick={uploadSigned} disabled={uploading}>
                <Upload className="h-4 w-4 mr-2" />
                {uploading ? t('common.loading') : t('meetings.minutes.uploadSigned')}
              </Button>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
