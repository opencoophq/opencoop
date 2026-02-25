'use client';

import { useEffect, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { useAdmin } from '@/contexts/admin-context';
import { useLocale } from '@/contexts/locale-context';
import { Link } from '@/i18n/routing';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api } from '@/lib/api';
import { Search, Plus, ChevronLeft, ChevronRight } from 'lucide-react';

interface ShareholderRow {
  id: string;
  type: string;
  status: string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
  email?: string;
  createdAt: string;
  shares: Array<{ quantity: number; status: string; purchaseDate: string }>;
}

interface PaginatedResponse {
  items: ShareholderRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export default function ShareholdersPage() {
  const t = useTranslations();
  const { selectedCoop } = useAdmin();
  const { locale } = useLocale();
  const [data, setData] = useState<PaginatedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [page, setPage] = useState(1);

  const loadData = useCallback(async () => {
    if (!selectedCoop) return;
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: '25' });
    if (search) params.set('search', search);
    if (statusFilter !== 'all') params.set('status', statusFilter);
    if (typeFilter !== 'all') params.set('type', typeFilter);

    try {
      const result = await api<PaginatedResponse>(
        `/admin/coops/${selectedCoop.id}/shareholders?${params}`,
      );
      setData(result);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [selectedCoop, page, search, statusFilter, typeFilter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const getName = (sh: ShareholderRow) =>
    sh.type === 'COMPANY'
      ? sh.companyName || ''
      : `${sh.firstName || ''} ${sh.lastName || ''}`.trim();

  const activeShares = (sh: ShareholderRow) =>
    sh.shares?.filter((s) => s.status === 'ACTIVE').reduce((sum, s) => sum + s.quantity, 0) || 0;

  const memberSince = (sh: ShareholderRow) => {
    const dates = sh.shares?.map((s) => s.purchaseDate).filter(Boolean) || [];
    if (dates.length === 0) return sh.createdAt;
    return dates.reduce((earliest, d) => (d < earliest ? d : earliest));
  };

  if (!selectedCoop) return <p className="text-muted-foreground">{t('admin.selectCoop')}</p>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t('admin.shareholders.title')}</h1>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          {t('admin.shareholders.add')}
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-3 mb-4">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t('common.search')}
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className="pl-10"
              />
            </div>
            <Select
              value={statusFilter}
              onValueChange={(v) => {
                setStatusFilter(v);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder={t('common.status')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('common.all')}</SelectItem>
                <SelectItem value="ACTIVE">{t('shareholder.statuses.ACTIVE')}</SelectItem>
                <SelectItem value="PENDING">{t('shareholder.statuses.PENDING')}</SelectItem>
                <SelectItem value="INACTIVE">{t('shareholder.statuses.INACTIVE')}</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={typeFilter}
              onValueChange={(v) => {
                setTypeFilter(v);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder={t('common.type')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('common.all')}</SelectItem>
                <SelectItem value="INDIVIDUAL">{t('shareholder.types.INDIVIDUAL')}</SelectItem>
                <SelectItem value="COMPANY">{t('shareholder.types.COMPANY')}</SelectItem>
                <SelectItem value="MINOR">{t('shareholder.types.MINOR')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {loading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : !data || data.items.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">{t('common.noResults')}</p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('common.name')}</TableHead>
                    <TableHead>{t('common.type')}</TableHead>
                    <TableHead>{t('common.email')}</TableHead>
                    <TableHead className="text-right">{t('shares.title')}</TableHead>
                    <TableHead>{t('common.status')}</TableHead>
                    <TableHead>{t('shareholder.memberSince')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((sh) => (
                    <TableRow key={sh.id}>
                      <TableCell>
                        <Link
                          href={`/dashboard/admin/shareholders/${sh.id}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {getName(sh)}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{t(`shareholder.types.${sh.type}`)}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{sh.email || '-'}</TableCell>
                      <TableCell className="text-right">{activeShares(sh)}</TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            sh.status === 'ACTIVE'
                              ? 'default'
                              : sh.status === 'PENDING'
                                ? 'secondary'
                                : 'destructive'
                          }
                        >
                          {t(`shareholder.statuses.${sh.status}`)}
                        </Badge>
                      </TableCell>
                      <TableCell>{new Date(memberSince(sh)).toLocaleDateString(locale)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {data.totalPages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <p className="text-sm text-muted-foreground">
                    {t('common.showing')} {(data.page - 1) * data.pageSize + 1}-
                    {Math.min(data.page * data.pageSize, data.total)} {t('common.of')} {data.total}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page === 1}
                      onClick={() => setPage(page - 1)}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page >= data.totalPages}
                      onClick={() => setPage(page + 1)}
                    >
                      <ChevronRight className="h-4 w-4" />
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
