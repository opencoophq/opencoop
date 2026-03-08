'use client';

import { useEffect, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { useLocale } from '@/contexts/locale-context';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api } from '@/lib/api';
import { History, ChevronLeft, ChevronRight } from 'lucide-react';

interface AuditChange {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

interface AuditLogEntry {
  id: string;
  coopId: string | null;
  entity: string;
  entityId: string;
  action: string;
  changes: AuditChange[];
  actorId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  actor: { id: string; email: string; name: string | null } | null;
  coop: { id: string; name: string; slug: string } | null;
}

interface AuditLogResponse {
  items: AuditLogEntry[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

const ENTITY_OPTIONS = ['All', 'Auth', 'Shareholder', 'User', 'Coop', 'Channel', 'ShareClass', 'Project', 'DividendPeriod'] as const;

function formatValue(val: unknown): string {
  if (val === null || val === undefined) return '-';
  if (val === '***') return '***';
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

function summarizeChanges(changes: AuditChange[]): string {
  if (!changes || changes.length === 0) return '-';

  return changes
    .map((c) => {
      const oldStr = formatValue(c.oldValue);
      const newStr = formatValue(c.newValue);
      return `${c.field}: ${oldStr} \u2192 ${newStr}`;
    })
    .join(', ');
}

export default function SystemAuditPage() {
  const t = useTranslations();
  const { locale } = useLocale();
  const [data, setData] = useState<AuditLogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [entityFilter, setEntityFilter] = useState<string>('All');

  const fetchLogs = useCallback(() => {
    setLoading(true);

    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('limit', '50');
    if (entityFilter !== 'All') {
      params.set('entity', entityFilter);
    }

    api<AuditLogResponse>(`/system/audit-logs?${params.toString()}`)
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [page, entityFilter]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const handleEntityChange = (value: string) => {
    setEntityFilter(value);
    setPage(1);
  };

  const actionVariant = (action: string) => {
    switch (action) {
      case 'CREATE':
      case 'LOGIN':
      case 'REGISTER':
      case 'MFA_VERIFY':
        return 'default';
      case 'DELETE':
      case 'LOGIN_FAILED':
      case 'MFA_VERIFY_FAILED':
        return 'destructive';
      default:
        return 'secondary';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <History className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">{t('audit.title')}</h1>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-muted-foreground">
            {t('audit.entity')}
          </label>
          <Select value={entityFilter} onValueChange={handleEntityChange}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ENTITY_OPTIONS.map((entity) => (
                <SelectItem key={entity} value={entity}>
                  {entity === 'All' ? t('common.all') : entity}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : !data || data.items.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              {t('audit.noChanges')}
            </p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('audit.date')}</TableHead>
                    <TableHead>{t('system.coops.coopName')}</TableHead>
                    <TableHead>{t('audit.entity')}</TableHead>
                    <TableHead>{t('audit.action')}</TableHead>
                    <TableHead className="min-w-[300px]">{t('audit.changes')}</TableHead>
                    <TableHead>{t('audit.changedBy')}</TableHead>
                    <TableHead>{t('audit.ip')}</TableHead>
                    <TableHead>{t('audit.userAgent')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((entry) => {
                    const changeSummary = summarizeChanges(entry.changes);
                    const truncated =
                      changeSummary.length > 120
                        ? changeSummary.slice(0, 120) + '...'
                        : changeSummary;

                    return (
                      <TableRow key={entry.id}>
                        <TableCell className="whitespace-nowrap">
                          {new Date(entry.createdAt).toLocaleDateString(locale)}{' '}
                          <span className="text-muted-foreground text-xs">
                            {new Date(entry.createdAt).toLocaleTimeString(locale, {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </TableCell>
                        <TableCell>{entry.coop?.name ?? '\u2014'}</TableCell>
                        <TableCell>
                          <span className="text-sm">
                            {entry.entity}
                            <span className="text-muted-foreground text-xs ml-1">
                              {entry.entityId.slice(0, 8)}
                            </span>
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge variant={actionVariant(entry.action)}>
                            {t(`audit.actions.${entry.action}`)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <span
                            className="text-sm text-muted-foreground font-mono"
                            title={changeSummary}
                          >
                            {truncated}
                          </span>
                        </TableCell>
                        <TableCell>
                          {entry.actor?.email ?? t('audit.system')}
                        </TableCell>
                        <TableCell className="text-xs font-mono">{entry.ipAddress ?? '\u2014'}</TableCell>
                        <TableCell className="text-xs max-w-[200px] truncate" title={entry.userAgent ?? ''}>
                          {entry.userAgent ?? '\u2014'}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>

              {/* Pagination */}
              {data.totalPages > 1 && (
                <div className="flex items-center justify-between pt-4">
                  <p className="text-sm text-muted-foreground">
                    {data.page} / {data.totalPages} ({data.total} {t('common.total').toLowerCase()})
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => p - 1)}
                    >
                      <ChevronLeft className="h-4 w-4 mr-1" />
                      {t('common.previous')}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page >= data.totalPages}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      {t('common.next')}
                      <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
