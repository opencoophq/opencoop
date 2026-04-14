'use client';

import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CheckCircle2, Download, Upload, Loader2 } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

type ThanksStatus = 'attending' | 'absent' | 'proxy';

export default function PublicRsvpThanksPage() {
  const t = useTranslations();
  const params = useParams();
  const searchParams = useSearchParams();
  const token = (params?.token as string) || '';
  const status = (searchParams?.get('status') as ThanksStatus | null) ?? 'attending';

  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<'ok' | 'error' | null>(null);

  useEffect(() => {
    setUploadResult(null);
  }, [status]);

  const downloadIcs = () => {
    window.location.href = `${API_URL}/public/meetings/rsvp/${token}/ics`;
  };

  const handleUpload = async (file: File | null) => {
    if (!file || !token) return;
    setUploading(true);
    setUploadResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(
        `${API_URL}/public/meetings/rsvp/${token}/proxy/upload`,
        {
          method: 'POST',
          body: fd,
        },
      );
      setUploadResult(res.ok ? 'ok' : 'error');
    } catch {
      setUploadResult('error');
    } finally {
      setUploading(false);
    }
  };

  const heading =
    status === 'absent'
      ? t('meetings.publicRsvp.thanks.absentHeading')
      : status === 'proxy'
        ? t('meetings.publicRsvp.thanks.proxyHeading')
        : t('meetings.publicRsvp.thanks.attendingHeading');

  const body =
    status === 'absent'
      ? t('meetings.publicRsvp.thanks.absentBody')
      : status === 'proxy'
        ? t('meetings.publicRsvp.thanks.proxyBody')
        : t('meetings.publicRsvp.thanks.attendingBody');

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12">
      <Card className="max-w-md w-full">
        <CardContent className="pt-6 space-y-5">
          <div className="text-center space-y-3">
            <CheckCircle2 className="h-12 w-12 text-green-600 mx-auto" />
            <h1 className="text-2xl font-bold">{heading}</h1>
            <p className="text-sm text-muted-foreground">{body}</p>
          </div>

          {status === 'attending' && (
            <Button onClick={downloadIcs} variant="outline" className="w-full">
              <Download className="h-4 w-4 mr-2" />
              {t('meetings.publicRsvp.thanks.downloadIcs')}
            </Button>
          )}

          {status === 'proxy' && (
            <div className="space-y-3 pt-2 border-t">
              <p className="text-sm font-medium">
                {t('meetings.publicRsvp.thanks.proxyUploadHeading')}
              </p>
              <p className="text-xs text-muted-foreground">
                {t('meetings.publicRsvp.thanks.proxyUploadHelp')}
              </p>
              <label className="block">
                <input
                  type="file"
                  accept="application/pdf,image/png,image/jpeg"
                  className="hidden"
                  disabled={uploading}
                  onChange={(e) => handleUpload(e.target.files?.[0] ?? null)}
                />
                <span
                  className={`flex items-center justify-center gap-2 w-full h-10 rounded-md border bg-background text-sm cursor-pointer hover:bg-accent transition-colors ${
                    uploading ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                >
                  {uploading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4" />
                  )}
                  {t('meetings.publicRsvp.thanks.proxyUploadButton')}
                </span>
              </label>
              {uploadResult === 'ok' && (
                <Alert>
                  <AlertDescription>
                    {t('meetings.publicRsvp.thanks.uploadSuccess')}
                  </AlertDescription>
                </Alert>
              )}
              {uploadResult === 'error' && (
                <Alert variant="destructive">
                  <AlertDescription>
                    {t('meetings.publicRsvp.thanks.uploadError')}
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
