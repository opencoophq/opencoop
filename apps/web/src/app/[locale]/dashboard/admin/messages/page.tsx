'use client';

import { useEffect, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { useAdmin } from '@/contexts/admin-context';
import { useLocale } from '@/contexts/locale-context';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { api } from '@/lib/api';
import { Plus } from 'lucide-react';

interface ConversationListItem {
  id: string;
  subject: string;
  type: 'BROADCAST' | 'DIRECT';
  updatedAt: string;
  messages: Array<{
    body: string;
    createdAt: string;
    senderType: string;
  }>;
  _count: {
    participants: number;
    messages: number;
  };
}

interface ConversationsResponse {
  conversations: ConversationListItem[];
  total: number;
  page: number;
  totalPages: number;
}

export default function AdminMessagesPage() {
  const t = useTranslations();
  const { selectedCoop } = useAdmin();
  const { locale } = useLocale();
  const [data, setData] = useState<ConversationsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  const fetchConversations = useCallback(async () => {
    if (!selectedCoop) return;
    setLoading(true);
    try {
      const result = await api<ConversationsResponse>(
        `/admin/coops/${selectedCoop.id}/conversations?page=${page}`,
      );
      setData(result);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [selectedCoop, page]);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

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

  const conversations = data?.conversations || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t('messages.title')}</h1>
        <Button asChild>
          <Link href="/dashboard/admin/messages/new">
            <Plus className="h-4 w-4 mr-2" />
            {t('messages.newConversation')}
          </Link>
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          {conversations.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {t('messages.noConversations')}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('common.type')}</TableHead>
                  <TableHead>{t('messages.subject')}</TableHead>
                  <TableHead>{t('messages.body')}</TableHead>
                  <TableHead>{t('messages.participants')}</TableHead>
                  <TableHead>{t('common.date')}</TableHead>
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
                      <TableCell>
                        <Badge variant={conv.type === 'BROADCAST' ? 'default' : 'secondary'}>
                          {t(`messages.${conv.type.toLowerCase()}`)}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium">
                        <Link
                          href={`/dashboard/admin/messages/${conv.id}`}
                          className="hover:underline"
                        >
                          {conv.subject}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{preview}</TableCell>
                      <TableCell>{conv._count.participants}</TableCell>
                      <TableCell>
                        {new Date(conv.updatedAt).toLocaleDateString(locale)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}

          {data && data.totalPages > 1 && (
            <div className="flex items-center justify-between pt-4">
              <p className="text-sm text-muted-foreground">
                {t('common.showing')} {conversations.length} {t('common.of')} {data.total}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  {t('common.previous')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= data.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  {t('common.next')}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
