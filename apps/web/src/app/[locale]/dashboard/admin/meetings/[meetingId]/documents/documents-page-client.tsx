'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';
import { useAdmin } from '@/contexts/admin-context';

type MeetingDoc = {
  id: string;
  fileName: string;
  fileSize: number;
  order: number;
};

export function DocumentsPageClient() {
  const t = useTranslations('meetings.documents');
  const params = useParams();
  const meetingId = (params?.meetingId as string) || '';
  const { selectedCoop } = useAdmin();

  const [docs, setDocs] = useState<MeetingDoc[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchDocs = useCallback(async () => {
    if (!selectedCoop || !meetingId) return;
    setLoading(true);
    try {
      const data = await api<MeetingDoc[]>(
        `/admin/coops/${selectedCoop.id}/meetings/${meetingId}/documents`,
      );
      setDocs(data);
    } finally {
      setLoading(false);
    }
  }, [selectedCoop, meetingId]);

  useEffect(() => {
    fetchDocs();
  }, [fetchDocs]);

  if (!selectedCoop) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Select a coop first.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 p-6">
      <header>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-muted-foreground">{t('description')}</p>
      </header>

      <DocumentList
        docs={docs}
        loading={loading}
        coopId={selectedCoop.id}
        meetingId={meetingId}
        onChange={fetchDocs}
      />
      {/* MailDraftSection + SendSection + StatusTable added in Tasks 11–12 */}
    </div>
  );
}

function DocumentList({
  docs,
  loading,
  coopId,
  meetingId,
  onChange,
}: {
  docs: MeetingDoc[];
  loading: boolean;
  coopId: string;
  meetingId: string;
  onChange: () => void;
}) {
  const t = useTranslations('meetings.documents');
  const [uploading, setUploading] = useState(false);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      await api(`/admin/coops/${coopId}/meetings/${meetingId}/documents`, {
        method: 'POST',
        body: fd,
      });
      onChange();
    } finally {
      setUploading(false);
    }
  };

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-medium">{t('title')}</h2>
      {loading ? (
        <div className="animate-pulse h-20 rounded bg-muted" />
      ) : (
        <ul className="divide-y rounded border">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center justify-between p-3">
              <span>{d.fileName}</span>
              <span className="text-sm text-muted-foreground">{formatSize(d.fileSize)}</span>
            </li>
          ))}
        </ul>
      )}
      <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <span>{uploading ? '...' : t('uploadCta')}</span>
        <input
          type="file"
          accept="application/pdf"
          className="hidden"
          disabled={uploading}
          onChange={handleFileChange}
        />
      </label>
    </section>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
