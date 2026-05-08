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
      {/* MailDraftSection + SendSection + StatusTable added in Task 12 */}
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

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
