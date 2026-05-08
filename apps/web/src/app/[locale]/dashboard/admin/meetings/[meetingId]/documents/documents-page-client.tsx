'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { api } from '@/lib/api';
import { useAdmin } from '@/contexts/admin-context';

type MeetingDoc = {
  id: string;
  fileName: string;
  fileSize: number;
  order: number;
};

type EmailDraft = {
  subject: string | null;
  intro: string | null;
  sentAt: string | null;
  recipientCount: number;
  sentCount: number;
  failedCount: number;
};

type AttendanceStatus = {
  shareholderName: string;
  documentsEmailSentAt: string | null;
  documentsEmailError: string | null;
  documentsEmailOpenedAt: string | null;
  documentsDownloadedAt: string | null;
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
        setDocs={setDocs}
        loading={loading}
        coopId={selectedCoop.id}
        meetingId={meetingId}
        onChange={fetchDocs}
      />
      <MailDraftSection
        coopId={selectedCoop.id}
        meetingId={meetingId}
        hasDocuments={docs.length > 0}
      />
      <StatusTable coopId={selectedCoop.id} meetingId={meetingId} />
    </div>
  );
}

function DocumentList({
  docs,
  setDocs,
  loading,
  coopId,
  meetingId,
  onChange,
}: {
  docs: MeetingDoc[];
  setDocs: React.Dispatch<React.SetStateAction<MeetingDoc[]>>;
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

  const handleRename = async (id: string, displayName: string) => {
    await api(`/admin/coops/${coopId}/meetings/${meetingId}/documents/${id}`, {
      method: 'PATCH',
      body: { displayName },
    });
    onChange();
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t('confirmDelete'))) return;
    await api(`/admin/coops/${coopId}/meetings/${meetingId}/documents/${id}`, {
      method: 'DELETE',
    });
    onChange();
  };

  const handleDragEnd = async (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const oldIdx = docs.findIndex((d) => d.id === e.active.id);
    const newIdx = docs.findIndex((d) => d.id === e.over!.id);
    const reordered = arrayMove(docs, oldIdx, newIdx);
    // Optimistic update
    setDocs(reordered);
    // Persist changed orders
    await Promise.all(
      reordered
        .map((d, idx) => ({ ...d, newOrder: idx }))
        .filter((d) => d.order !== d.newOrder)
        .map((d) =>
          api(`/admin/coops/${coopId}/meetings/${meetingId}/documents/${d.id}`, {
            method: 'PATCH',
            body: { order: d.newOrder },
          }),
        ),
    );
    // Sync server state (updates `order` fields on docs)
    onChange();
  };

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-medium">{t('title')}</h2>
      {loading ? (
        <div className="animate-pulse h-20 rounded bg-muted" />
      ) : (
        <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={docs.map((d) => d.id)} strategy={verticalListSortingStrategy}>
            <ul className="divide-y rounded border">
              {docs.map((d) => (
                <SortableRow
                  key={d.id}
                  doc={d}
                  onRename={handleRename}
                  onDelete={handleDelete}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
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

function SortableRow({
  doc,
  onRename,
  onDelete,
}: {
  doc: MeetingDoc;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}) {
  const t = useTranslations('meetings.documents');
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: doc.id,
  });
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(doc.fileName);

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className="flex items-center gap-3 border-b p-3 last:border-b-0"
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab text-muted-foreground"
        aria-label="reorder"
      >
        ⋮⋮
      </button>
      {editing ? (
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            setEditing(false);
            if (name.trim() && name !== doc.fileName) onRename(doc.id, name.trim());
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          className="flex-1 rounded border px-2 py-1 text-sm"
        />
      ) : (
        <button
          className="flex-1 text-left text-sm hover:underline"
          onClick={() => setEditing(true)}
          title={t('rename')}
        >
          {doc.fileName}
        </button>
      )}
      <span className="text-sm text-muted-foreground">{formatSize(doc.fileSize)}</span>
      <button
        onClick={() => onDelete(doc.id)}
        className="text-sm text-red-600 hover:text-red-800"
      >
        {t('delete')}
      </button>
    </li>
  );
}

function MailDraftSection({
  coopId,
  meetingId,
  hasDocuments,
}: {
  coopId: string;
  meetingId: string;
  hasDocuments: boolean;
}) {
  const t = useTranslations('meetings.documents');
  const [data, setData] = useState<EmailDraft | null>(null);
  const [subject, setSubject] = useState('');
  const [intro, setIntro] = useState('');
  const [sending, setSending] = useState(false);

  const fetchDraft = useCallback(async () => {
    const d = await api<EmailDraft>(
      `/admin/coops/${coopId}/meetings/${meetingId}/documents-email`,
    );
    setData(d);
    setSubject(d.subject ?? '');
    setIntro(d.intro ?? '');
  }, [coopId, meetingId]);

  useEffect(() => {
    fetchDraft();
  }, [fetchDraft]);

  const saveDraft = async () => {
    await api(`/admin/coops/${coopId}/meetings/${meetingId}/documents-email`, {
      method: 'PATCH',
      body: JSON.stringify({ subject, intro }),
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const send = async () => {
    const count = data?.recipientCount ?? 0;
    if (!confirm(t('sendConfirm', { count }))) return;
    setSending(true);
    try {
      await api(`/admin/coops/${coopId}/meetings/${meetingId}/documents-email/send`, {
        method: 'POST',
      });
      await fetchDraft();
    } finally {
      setSending(false);
    }
  };

  if (!data) return null;

  const canSend = hasDocuments && data.recipientCount > 0;

  return (
    <section className="space-y-4 rounded border p-4">
      <h2 className="text-lg font-medium">{t('subjectLabel')}</h2>

      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-sm font-medium">{t('subjectLabel')}</label>
          <input
            type="text"
            value={subject}
            placeholder={t('subjectPlaceholder')}
            onChange={(e) => setSubject(e.target.value)}
            onBlur={saveDraft}
            className="w-full rounded border px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">{t('introLabel')}</label>
          <textarea
            rows={4}
            value={intro}
            placeholder={t('introPlaceholder')}
            onChange={(e) => setIntro(e.target.value)}
            onBlur={saveDraft}
            className="w-full rounded border px-3 py-2 text-sm"
          />
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        {t('recipientCount', { count: data.recipientCount })}
      </p>

      {!data.sentAt && (
        <button
          onClick={send}
          disabled={!canSend || sending}
          className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
        >
          {sending ? '...' : t('sendCta')}
        </button>
      )}

      {data.sentAt && data.failedCount > 0 && (
        <button
          onClick={send}
          disabled={sending}
          className="rounded bg-destructive px-4 py-2 text-sm text-destructive-foreground disabled:opacity-50"
        >
          {sending ? '...' : t('resendFailed', { count: data.failedCount })}
        </button>
      )}

      {data.sentAt && (
        <p className="text-sm text-muted-foreground">
          {t('sentSummary', {
            date: new Date(data.sentAt).toLocaleDateString(),
            sent: data.sentCount,
            total: data.recipientCount,
          })}
        </p>
      )}
    </section>
  );
}

function StatusTable({ coopId, meetingId }: { coopId: string; meetingId: string }) {
  const t = useTranslations('meetings.documents');
  const [rows, setRows] = useState<AttendanceStatus[]>([]);

  useEffect(() => {
    const fetchStatuses = async () => {
      const r = await api<AttendanceStatus[]>(
        `/admin/coops/${coopId}/meetings/${meetingId}/rsvp/attendance-statuses`,
      ).catch(() => [] as AttendanceStatus[]);
      setRows(r);
    };
    fetchStatuses();
    const id = setInterval(fetchStatuses, 10_000);
    return () => clearInterval(id);
  }, [coopId, meetingId]);

  if (rows.length === 0) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-medium">{t('statusTitle')}</h2>
      <div className="overflow-x-auto rounded border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Coöperant</th>
              <th className="px-3 py-2">{t('status.sent')}</th>
              <th className="px-3 py-2">{t('status.opened')}</th>
              <th className="px-3 py-2">{t('status.downloaded')}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row, idx) => (
              <tr key={idx} className="hover:bg-muted/30">
                <td className="px-3 py-2">{row.shareholderName}</td>
                <td className="px-3 py-2">
                  {row.documentsEmailError ? (
                    <span className="text-red-600" title={row.documentsEmailError}>
                      ✗ {row.documentsEmailError}
                    </span>
                  ) : row.documentsEmailSentAt ? (
                    <span className="text-green-600">✓</span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {row.documentsEmailOpenedAt ? (
                    <span className="text-green-600">✓</span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {row.documentsDownloadedAt ? (
                    <span className="text-green-600">✓</span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
