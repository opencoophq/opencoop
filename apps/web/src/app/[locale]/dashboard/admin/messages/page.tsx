'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { useAdmin } from '@/contexts/admin-context';
import { useLocale } from '@/contexts/locale-context';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { api } from '@/lib/api';
import {
  applyColumnFiltersAndSort,
  toggleColumnSort,
  type ColumnSortState,
} from '@/lib/table-utils';
import { Plus, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';

interface ConversationParticipant {
  shareholder: {
    firstName: string;
    lastName: string;
    companyName: string | null;
    type: string;
  };
}

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
  participants: ConversationParticipant[];
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

type MessageColumn = 'type' | 'subject' | 'body' | 'participants' | 'date';

export default function AdminMessagesPage() {
  const t = useTranslations();
  const { selectedCoop } = useAdmin();
  const { locale } = useLocale();
  const [allConversations, setAllConversations] = useState<ConversationListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [columnFilters, setColumnFilters] = useState<Partial<Record<MessageColumn, string>>>({});
  const [columnSort, setColumnSort] = useState<ColumnSortState<MessageColumn>>({
    column: null,
    direction: 'asc',
  });
  const pageSize = 20;

  const fetchConversations = useCallback(async () => {
    if (!selectedCoop) return;
    setLoading(true);
    try {
      const all: ConversationListItem[] = [];
      let currentPage = 1;
      let totalPages = 1;

      while (currentPage <= totalPages) {
        const result = await api<ConversationsResponse>(
          `/admin/coops/${selectedCoop.id}/conversations?page=${currentPage}`,
        );
        all.push(...result.conversations);
        totalPages = result.totalPages || 1;
        currentPage += 1;
      }

      setAllConversations(all);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [selectedCoop]);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  const conversationParticipantsLabel = useCallback((conv: ConversationListItem): string => {
    if (conv.type === 'BROADCAST') return t('messages.allShareholders');
    const names = conv.participants.map((p) =>
      p.shareholder.type === 'COMPANY'
        ? (p.shareholder.companyName ?? '')
        : `${p.shareholder.firstName} ${p.shareholder.lastName}`.trim(),
    );
    const total = conv._count.participants;
    if (names.length === 0) return String(total);
    const shown = names.slice(0, 2).join(', ');
    return total > 2 ? `${shown}, ...` : shown;
  }, [t]);

  const visibleConversations = useMemo(
    () =>
      applyColumnFiltersAndSort(
        allConversations,
        {
          type: { accessor: (conv) => conv.type },
          subject: { accessor: (conv) => conv.subject },
          body: { accessor: (conv) => conv.messages[0]?.body || '' },
          participants: { accessor: (conv) => conversationParticipantsLabel(conv) },
          date: { accessor: (conv) => conv.updatedAt },
        },
        columnFilters,
        columnSort,
      ),
    [allConversations, columnFilters, columnSort, conversationParticipantsLabel],
  );

  const totalPages = Math.max(1, Math.ceil(visibleConversations.length / pageSize));
  const pagedConversations = useMemo(
    () => visibleConversations.slice((page - 1) * pageSize, page * pageSize),
    [visibleConversations, page, pageSize],
  );

  useEffect(() => {
    setPage(1);
  }, [columnFilters, columnSort]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const sortIcon = (column: MessageColumn) => {
    if (columnSort.column !== column) return <ArrowUpDown className="h-4 w-4 ml-1" />;
    return columnSort.direction === 'asc' ? (
      <ArrowUp className="h-4 w-4 ml-1" />
    ) : (
      <ArrowDown className="h-4 w-4 ml-1" />
    );
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
          {allConversations.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {t('messages.noConversations')}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <Button variant="ghost" size="sm" onClick={() => setColumnSort((prev) => toggleColumnSort(prev, 'type'))}>
                      {t('common.type')}
                      {sortIcon('type')}
                    </Button>
                  </TableHead>
                  <TableHead>
                    <Button variant="ghost" size="sm" onClick={() => setColumnSort((prev) => toggleColumnSort(prev, 'subject'))}>
                      {t('messages.subject')}
                      {sortIcon('subject')}
                    </Button>
                  </TableHead>
                  <TableHead>
                    <Button variant="ghost" size="sm" onClick={() => setColumnSort((prev) => toggleColumnSort(prev, 'body'))}>
                      {t('messages.body')}
                      {sortIcon('body')}
                    </Button>
                  </TableHead>
                  <TableHead>
                    <Button variant="ghost" size="sm" onClick={() => setColumnSort((prev) => toggleColumnSort(prev, 'participants'))}>
                      {t('messages.participants')}
                      {sortIcon('participants')}
                    </Button>
                  </TableHead>
                  <TableHead>
                    <Button variant="ghost" size="sm" onClick={() => setColumnSort((prev) => toggleColumnSort(prev, 'date'))}>
                      {t('common.date')}
                      {sortIcon('date')}
                    </Button>
                  </TableHead>
                </TableRow>
                <TableRow>
                  <TableHead>
                    <Input
                      value={columnFilters.type || ''}
                      onChange={(e) => setColumnFilters((prev) => ({ ...prev, type: e.target.value }))}
                      placeholder={t('common.filter')}
                      className="h-8"
                    />
                  </TableHead>
                  <TableHead>
                    <Input
                      value={columnFilters.subject || ''}
                      onChange={(e) => setColumnFilters((prev) => ({ ...prev, subject: e.target.value }))}
                      placeholder={t('common.filter')}
                      className="h-8"
                    />
                  </TableHead>
                  <TableHead>
                    <Input
                      value={columnFilters.body || ''}
                      onChange={(e) => setColumnFilters((prev) => ({ ...prev, body: e.target.value }))}
                      placeholder={t('common.filter')}
                      className="h-8"
                    />
                  </TableHead>
                  <TableHead>
                    <Input
                      value={columnFilters.participants || ''}
                      onChange={(e) => setColumnFilters((prev) => ({ ...prev, participants: e.target.value }))}
                      placeholder={t('common.filter')}
                      className="h-8"
                    />
                  </TableHead>
                  <TableHead>
                    <Input
                      value={columnFilters.date || ''}
                      onChange={(e) => setColumnFilters((prev) => ({ ...prev, date: e.target.value }))}
                      placeholder={t('common.filter')}
                      className="h-8"
                    />
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleConversations.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-6">
                      {t('common.noResults')}
                    </TableCell>
                  </TableRow>
                ) : (
                  pagedConversations.map((conv) => {
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
                        <TableCell>{conversationParticipantsLabel(conv)}</TableCell>
                        <TableCell>
                          {new Date(conv.updatedAt).toLocaleDateString(locale)}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-4">
              <p className="text-sm text-muted-foreground">
                {t('common.showing')} {(page - 1) * pageSize + 1}-
                {Math.min(page * pageSize, visibleConversations.length)} {t('common.of')} {visibleConversations.length}
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
                  disabled={page >= totalPages}
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
