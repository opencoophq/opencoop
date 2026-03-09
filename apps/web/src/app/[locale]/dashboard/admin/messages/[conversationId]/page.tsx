'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useLocale } from '@/contexts/locale-context';
import { useAdmin } from '@/contexts/admin-context';
import { Link } from '@/i18n/routing';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import { ArrowLeft, Loader2, Paperclip } from 'lucide-react';

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

interface Participant {
  id: string;
  readAt: string | null;
  shareholder: {
    id: string;
    firstName: string;
    lastName: string;
    companyName?: string;
    email: string;
    type: string;
  };
}

interface ConversationDetail {
  id: string;
  subject: string;
  type: 'BROADCAST' | 'DIRECT';
  messages: Message[];
  participants: Participant[];
  _count: {
    participants: number;
  };
}

export default function AdminConversationDetailPage() {
  const t = useTranslations();
  const { locale } = useLocale();
  const { selectedCoop } = useAdmin();
  const params = useParams();
  const conversationId = params.conversationId as string;

  const [conversation, setConversation] = useState<ConversationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);

  const loadConversation = async () => {
    if (!selectedCoop) return;
    try {
      const data = await api<ConversationDetail>(
        `/admin/coops/${selectedCoop.id}/conversations/${conversationId}`,
      );
      setConversation(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadConversation();
  }, [selectedCoop, conversationId]);

  const handleReply = async () => {
    if (!selectedCoop || !reply.trim()) return;
    setSending(true);
    try {
      await api(
        `/admin/coops/${selectedCoop.id}/conversations/${conversationId}/messages`,
        {
          method: 'POST',
          body: { body: reply },
        },
      );
      setReply('');
      await loadConversation();
    } catch {
      // ignore
    } finally {
      setSending(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedCoop || !conversation) return;

    // We need a message to attach to. Get the last admin message, or send the reply first.
    const lastMessage = conversation.messages[conversation.messages.length - 1];
    if (!lastMessage) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      await api(
        `/admin/coops/${selectedCoop.id}/conversations/${conversationId}/messages/${lastMessage.id}/attachments`,
        {
          method: 'POST',
          body: formData,
        },
      );
      await loadConversation();
    } catch {
      // ignore
    } finally {
      setUploading(false);
      // Reset file input
      e.target.value = '';
    }
  };

  const getSenderLabel = (msg: Message) => {
    if (msg.senderType === 'ADMIN') {
      return t('messages.admin');
    }
    // Find participant by senderId
    const participant = conversation?.participants.find(
      (p) => p.shareholder.id === msg.senderId,
    );
    if (participant) {
      const sh = participant.shareholder;
      if (sh.type === 'COMPANY' && sh.companyName) return sh.companyName;
      return `${sh.firstName} ${sh.lastName}`;
    }
    return t('messages.from');
  };

  if (!selectedCoop) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">{t('admin.selectCoop')}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="animate-pulse h-8 w-48 bg-muted rounded" />
        <div className="animate-pulse h-64 bg-muted rounded-lg" />
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

  const readCount = conversation.participants.filter((p) => p.readAt).length;
  const totalParticipants = conversation._count.participants;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button asChild variant="ghost" size="sm">
          <Link href="/dashboard/admin/messages">
            <ArrowLeft className="h-4 w-4 mr-1" />
            {t('messages.backToInbox')}
          </Link>
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">{conversation.subject}</h1>
        <Badge variant={conversation.type === 'BROADCAST' ? 'default' : 'secondary'}>
          {t(`messages.${conversation.type.toLowerCase()}`)}
        </Badge>
      </div>

      {conversation.type === 'BROADCAST' && (
        <p className="text-sm text-muted-foreground">
          {t('messages.participants')}: {totalParticipants} &middot;{' '}
          {t('messages.read')}: {readCount}/{totalParticipants}
        </p>
      )}

      <div className="space-y-4">
        {conversation.messages.map((msg) => {
          const isAdmin = msg.senderType === 'ADMIN';
          return (
            <Card key={msg.id} className={isAdmin ? 'border-primary/20 bg-primary/5' : ''}>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center justify-between mb-2">
                  <Badge variant={isAdmin ? 'default' : 'outline'}>
                    {getSenderLabel(msg)}
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
                      <span
                        key={att.id}
                        className="inline-flex items-center text-xs text-muted-foreground mr-3"
                      >
                        <Paperclip className="h-3 w-3 mr-1" />
                        {att.fileName || t('messages.attachments')}
                      </span>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardContent className="pt-4 pb-4">
          <Textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder={t('messages.replyPlaceholder')}
            rows={3}
          />
          <div className="flex items-center justify-between mt-3">
            <div>
              <input
                type="file"
                id="file-upload"
                className="hidden"
                onChange={handleFileUpload}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => document.getElementById('file-upload')?.click()}
                disabled={uploading}
              >
                {uploading ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Paperclip className="h-4 w-4 mr-1" />
                )}
                {t('messages.attachFile')}
              </Button>
            </div>
            <Button onClick={handleReply} disabled={sending || !reply.trim()}>
              {sending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t('messages.send')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
