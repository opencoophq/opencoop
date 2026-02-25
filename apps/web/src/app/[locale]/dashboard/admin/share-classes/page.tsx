'use client';

import { useEffect, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { useAdmin } from '@/contexts/admin-context';
import { useLocale } from '@/contexts/locale-context';
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
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { formatCurrency } from '@opencoop/shared';
import { Plus, Pencil } from 'lucide-react';

interface ShareClass {
  id: string;
  name: string;
  code: string;
  pricePerShare: number;
  minShares: number;
  maxShares: number | null;
  hasVotingRights: boolean;
  dividendRateOverride: number | null;
  isActive: boolean;
}

interface FormState {
  name: string;
  code: string;
  pricePerShare: string;
  minShares: string;
  maxShares: string;
  hasVotingRights: boolean;
  dividendRateOverride: string;
  isActive: boolean;
}

export default function ShareClassesPage() {
  const t = useTranslations();
  const { selectedCoop } = useAdmin();
  const { locale } = useLocale();
  const [classes, setClasses] = useState<ShareClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ShareClass | null>(null);
  const [form, setForm] = useState<FormState>({
    name: '',
    code: '',
    pricePerShare: '',
    minShares: '1',
    maxShares: '',
    hasVotingRights: true,
    dividendRateOverride: '',
    isActive: true,
  });

  const loadData = useCallback(async () => {
    if (!selectedCoop) return;
    setLoading(true);
    try {
      const data = await api<ShareClass[]>(`/admin/coops/${selectedCoop.id}/share-classes`);
      setClasses(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [selectedCoop]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const openCreate = () => {
    setEditing(null);
    setForm({
      name: '',
      code: '',
      pricePerShare: '',
      minShares: '1',
      maxShares: '',
      hasVotingRights: true,
      dividendRateOverride: '',
      isActive: true,
    });
    setDialogOpen(true);
  };

  const openEdit = (sc: ShareClass) => {
    setEditing(sc);
    setForm({
      name: sc.name,
      code: sc.code,
      pricePerShare: String(Number(sc.pricePerShare)),
      minShares: String(sc.minShares),
      maxShares: sc.maxShares ? String(sc.maxShares) : '',
      hasVotingRights: sc.hasVotingRights,
      dividendRateOverride: sc.dividendRateOverride ? String(Number(sc.dividendRateOverride)) : '',
      isActive: sc.isActive,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!selectedCoop) return;
    const body: Record<string, unknown> = {
      name: form.name,
      code: form.code,
      pricePerShare: parseFloat(form.pricePerShare),
      minShares: parseInt(form.minShares) || 1,
      hasVotingRights: form.hasVotingRights,
    };
    if (form.maxShares) body.maxShares = parseInt(form.maxShares);
    if (form.dividendRateOverride) body.dividendRateOverride = parseFloat(form.dividendRateOverride);
    if (editing) body.isActive = form.isActive;

    const url = editing
      ? `/admin/coops/${selectedCoop.id}/share-classes/${editing.id}`
      : `/admin/coops/${selectedCoop.id}/share-classes`;

    await api(url, { method: editing ? 'PUT' : 'POST', body });
    setDialogOpen(false);
    loadData();
  };

  if (!selectedCoop) return <p className="text-muted-foreground">{t('admin.selectCoop')}</p>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t('admin.shareClasses.title')}</h1>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-2" />
          {t('admin.shareClasses.add')}
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : classes.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">{t('common.noResults')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('common.name')}</TableHead>
                  <TableHead>{t('admin.shareClasses.code')}</TableHead>
                  <TableHead className="text-right">{t('shares.pricePerShare')}</TableHead>
                  <TableHead className="text-right">{t('admin.shareClasses.minShares')}</TableHead>
                  <TableHead className="text-right">{t('admin.shareClasses.maxShares')}</TableHead>
                  <TableHead>{t('admin.shareClasses.votingRights')}</TableHead>
                  <TableHead>{t('common.status')}</TableHead>
                  <TableHead>{t('common.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {classes.map((sc) => (
                  <TableRow key={sc.id}>
                    <TableCell className="font-medium">{sc.name}</TableCell>
                    <TableCell>{sc.code}</TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(Number(sc.pricePerShare), locale)}
                    </TableCell>
                    <TableCell className="text-right">{sc.minShares}</TableCell>
                    <TableCell className="text-right">{sc.maxShares ?? '\u221e'}</TableCell>
                    <TableCell>{sc.hasVotingRights ? '\u2713' : '-'}</TableCell>
                    <TableCell>
                      <Badge variant={sc.isActive ? 'default' : 'secondary'}>
                        {sc.isActive ? t('common.active') : t('common.inactive')}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" onClick={() => openEdit(sc)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing ? t('admin.shareClasses.edit') : t('admin.shareClasses.add')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>{t('common.name')}</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div>
              <Label>{t('admin.shareClasses.code')}</Label>
              <Input
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                disabled={!!editing}
              />
            </div>
            <div>
              <Label>{t('shares.pricePerShare')} (&euro;)</Label>
              <Input
                type="number"
                step="0.01"
                value={form.pricePerShare}
                onChange={(e) => setForm({ ...form, pricePerShare: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>{t('admin.shareClasses.minShares')}</Label>
                <Input
                  type="number"
                  value={form.minShares}
                  onChange={(e) => setForm({ ...form, minShares: e.target.value })}
                />
              </div>
              <div>
                <Label>{t('admin.shareClasses.maxShares')}</Label>
                <Input
                  type="number"
                  value={form.maxShares}
                  onChange={(e) => setForm({ ...form, maxShares: e.target.value })}
                  placeholder="\u221e"
                />
              </div>
            </div>
            <div>
              <Label>{t('dividends.dividendRate')} (%)</Label>
              <Input
                type="number"
                step="0.01"
                value={form.dividendRateOverride}
                onChange={(e) => setForm({ ...form, dividendRateOverride: e.target.value })}
                placeholder={t('dividends.useDefault')}
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                checked={form.hasVotingRights}
                onCheckedChange={(c) => setForm({ ...form, hasVotingRights: !!c })}
              />
              <Label>{t('admin.shareClasses.votingRights')}</Label>
            </div>
            {editing && (
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={form.isActive}
                  onCheckedChange={(c) => setForm({ ...form, isActive: !!c })}
                />
                <Label>{t('common.active')}</Label>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleSave}>{t('common.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
