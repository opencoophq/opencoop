'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useLocale } from '@/contexts/locale-context';
import { Link } from '@/i18n/routing';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { Plus, Loader2 } from 'lucide-react';

interface Conversation {
  id: string;
  subject: string;
  type: string;
  updatedAt: string;
  readAt: string | null;
  isUnread: boolean;
  messages: Array<{
    body: string;
    createdAt: string;
    senderType: string;
  }>;
}

export default function InboxPage() {
  const t = useTranslations();
  const { locale } = useLocale();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [shareholderId, setShareholderId] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    async function loadData() {
      try {
        const profile = await api<{ shareholders: Array<{ id: string }> }>('/auth/me');
        if (profile.shareholders?.[0]) {
          const shId = profile.shareholders[0].id;
          setShareholderId(shId);
          const data = await api<Conversation[]>(`/shareholders/${shId}/conversations`);
          setConversations(data);
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  const handleSend = async () => {
    if (!shareholderId || !subject.trim() || !body.trim()) return;
    setSending(true);
    try {
      await api(`/shareholders/${shareholderId}/conversations`, {
        method: 'POST',
        body: { subject, body },
      });
      setDialogOpen(false);
      setSubject('');
      setBody('');
      // Reload conversations
      const data = await api<Conversation[]>(`/shareholders/${shareholderId}/conversations`);
      setConversations(data);
    } catch {
      // ignore
    } finally {
      setSending(false);
    }
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
        <h1 className="text-2xl font-bold">{t('messages.title')}</h1>
        {shareholderId && (
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            {t('messages.newConversation')}
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="pt-6">
          {conversations.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">{t('messages.noConversations')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('messages.subject')}</TableHead>
                  <TableHead>{t('messages.body')}</TableHead>
                  <TableHead>{t('common.date')}</TableHead>
                  <TableHead>{t('common.status')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {conversations.map((conv) => {
                  const lastMessage = conv.messages[0];
                  const preview = lastMessage?.body
                    ? lastMessage.body.length > 80
                      ? lastMessage.body.slice(0, 80) + '...'
                      : lastMessage.body
                    : '';
                  return (
                    <TableRow key={conv.id} className="cursor-pointer hover:bg-muted/50">
                      <TableCell className={conv.isUnread ? 'font-semibold' : ''}>
                        <Link href={`/dashboard/inbox/${conv.id}`} className="hover:underline">
                          {conv.subject}
                        </Link>
                      </TableCell>
                      <TableCell className={`text-muted-foreground ${conv.isUnread ? 'font-medium' : ''}`}>
                        {preview}
                      </TableCell>
                      <TableCell>
                        {new Date(conv.updatedAt).toLocaleDateString(locale)}
                      </TableCell>
                      <TableCell>
                        {conv.isUnread ? (
                          <Badge variant="default">{t('messages.unread')}</Badge>
                        ) : (
                          <Badge variant="outline">{t('messages.read')}</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('messages.startConversation')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t('messages.subject')}</Label>
              <Input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder={t('messages.subjectPlaceholder')}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('messages.body')}</Label>
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={t('messages.bodyPlaceholder')}
                rows={5}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleSend} disabled={sending || !subject.trim() || !body.trim()}>
              {sending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t('messages.send')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
