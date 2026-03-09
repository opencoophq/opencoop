'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useLocale } from '@/contexts/locale-context';
import { Link } from '@/i18n/routing';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { api, apiFetch } from '@/lib/api';
import { ArrowLeft, Loader2, Download } from 'lucide-react';

interface Attachment {
  id: string;
  fileName: string;
  type: string;
  mimeType?: string;
}

interface Message {
  id: string;
  senderType: 'ADMIN' | 'SHAREHOLDER';
  senderId: string;
  body: string;
  createdAt: string;
  attachments: Attachment[];
}

interface ConversationDetail {
  id: string;
  subject: string;
  type: string;
  messages: Message[];
}

export default function ConversationDetailPage() {
  const t = useTranslations();
  const { locale } = useLocale();
  const params = useParams();
  const conversationId = params.conversationId as string;

  const [conversation, setConversation] = useState<ConversationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [shareholderId, setShareholderId] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    async function loadData() {
      try {
        const profile = await api<{ shareholders: Array<{ id: string }> }>('/auth/me');
        if (profile.shareholders?.[0]) {
          const shId = profile.shareholders[0].id;
          setShareholderId(shId);
          const data = await api<ConversationDetail>(
            `/shareholders/${shId}/conversations/${conversationId}`,
          );
          setConversation(data);
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [conversationId]);

  const handleReply = async () => {
    if (!shareholderId || !reply.trim()) return;
    setSending(true);
    try {
      await api(`/shareholders/${shareholderId}/conversations/${conversationId}/messages`, {
        method: 'POST',
        body: { body: reply },
      });
      setReply('');
      // Reload conversation
      const data = await api<ConversationDetail>(
        `/shareholders/${shareholderId}/conversations/${conversationId}`,
      );
      setConversation(data);
    } catch {
      // ignore
    } finally {
      setSending(false);
    }
  };

  const handleDownloadAttachment = async (attachmentId: string, fileName: string) => {
    if (!shareholderId) return;
    try {
      const response = await apiFetch(
        `/shareholders/${shareholderId}/conversations/${conversationId}/attachments/${attachmentId}`,
      );
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName || 'attachment';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
    } catch {
      // ignore
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!conversation) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        {t('common.noResults')}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button asChild variant="ghost" size="sm">
          <Link href="/dashboard/inbox">
            <ArrowLeft className="h-4 w-4 mr-1" />
            {t('messages.backToInbox')}
          </Link>
        </Button>
      </div>

      <h1 className="text-2xl font-bold">{conversation.subject}</h1>

      <div className="space-y-4">
        {conversation.messages.map((msg) => {
          const isAdmin = msg.senderType === 'ADMIN';
          return (
            <Card key={msg.id} className={isAdmin ? 'border-primary/20 bg-primary/5' : ''}>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center justify-between mb-2">
                  <Badge variant={isAdmin ? 'default' : 'outline'}>
                    {isAdmin ? t('messages.admin') : t('messages.you')}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {new Date(msg.createdAt).toLocaleDateString(locale)}{' '}
                    {new Date(msg.createdAt).toLocaleTimeString(locale, {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
                <p className="text-sm whitespace-pre-wrap">{msg.body}</p>
                {msg.attachments.length > 0 && (
                  <div className="mt-3 space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">
                      {t('messages.attachments')}
                    </p>
                    {msg.attachments.map((att) => (
                      <Button
                        key={att.id}
                        variant="ghost"
                        size="sm"
                        className="text-xs"
                        onClick={() => handleDownloadAttachment(att.id, att.fileName)}
                      >
                        <Download className="h-3 w-3 mr-1" />
                        {att.fileName || t('common.download')}
                      </Button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {shareholderId && (
        <Card>
          <CardContent className="pt-4 pb-4">
            <Textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder={t('messages.replyPlaceholder')}
              rows={3}
            />
            <div className="flex justify-end mt-3">
              <Button onClick={handleReply} disabled={sending || !reply.trim()}>
                {sending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {t('messages.send')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
