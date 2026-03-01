'use client';

import { useEffect, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link } from '@/i18n/routing';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useLocale } from '@/contexts/locale-context';
import { formatCurrency } from '@opencoop/shared';
import { Plus, Edit, Users } from 'lucide-react';
import { api } from '@/lib/api';

interface Coop {
  id: string;
  name: string;
  slug: string;
  emailEnabled: boolean;
  plan: string;
  trialEndsAt: string | null;
  subscriptionStatus: string | null;
  shareholdersCount: number;
  totalCapital: number;
  createdAt: string;
}

const coopSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  slug: z.string().min(1, 'Slug is required').regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
  emailEnabled: z.boolean(),
});

type CoopForm = z.infer<typeof coopSchema>;

export default function CoopsManagementPage() {
  const t = useTranslations();
  const { locale } = useLocale();
  const [coops, setCoops] = useState<Coop[]>([]);
  const [loading, setLoading] = useState(true);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCoop, setEditingCoop] = useState<Coop | null>(null);
  const [saving, setSaving] = useState(false);

  const form = useForm<CoopForm>({
    resolver: zodResolver(coopSchema),
    defaultValues: {
      name: '',
      slug: '',
      emailEnabled: true,
    },
  });

  const fetchCoops = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<Coop[] | { data: Coop[] }>('/system/coops');
      setCoops(Array.isArray(data) ? data : data.data || []);
    } catch {
      // Handle error silently
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCoops();
  }, [fetchCoops]);

  const openCreateDialog = () => {
    setEditingCoop(null);
    form.reset({
      name: '',
      slug: '',
      emailEnabled: true,
    });
    setDialogOpen(true);
  };

  const openEditDialog = (coop: Coop) => {
    setEditingCoop(coop);
    form.reset({
      name: coop.name,
      slug: coop.slug,
      emailEnabled: coop.emailEnabled,
    });
    setDialogOpen(true);
  };

  const onSubmit = async (data: CoopForm) => {
    setSaving(true);
    setError(null);

    try {
      const url = editingCoop
        ? `/system/coops/${editingCoop.id}`
        : '/system/coops';
      await api(url, {
        method: editingCoop ? 'PUT' : 'POST',
        body: data,
      });
      setSuccess(t('common.success'));
      setDialogOpen(false);
      fetchCoops();
    } catch {
      setError(t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  const fmtCurrency = (amount: number) => formatCurrency(amount, locale);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString(locale);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t('system.coops.title')}</h1>
        <Button onClick={openCreateDialog}>
          <Plus className="h-4 w-4 mr-2" />
          {t('system.coops.addCoop')}
        </Button>
      </div>

      {success && (
        <Alert>
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <div className="animate-pulse space-y-4">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-12 bg-muted rounded" />
              ))}
            </div>
          ) : coops.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {t('common.noResults')}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('system.coops.coopName')}</TableHead>
                  <TableHead>{t('system.coops.slug')}</TableHead>
                  <TableHead>{t('system.coops.plan')}</TableHead>
                  <TableHead>{t('system.coops.subscriptionStatus')}</TableHead>
                  <TableHead>{t('system.coops.emailStatus')}</TableHead>
                  <TableHead className="text-right">{t('system.coops.shareholders')}</TableHead>
                  <TableHead className="text-right">{t('system.coops.totalCapital')}</TableHead>
                  <TableHead>{t('system.coops.createdAt')}</TableHead>
                  <TableHead className="text-right">{t('system.coops.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {coops.map((coop) => (
                  <TableRow key={coop.id}>
                    <TableCell className="font-medium">{coop.name}</TableCell>
                    <TableCell>
                      <code className="text-sm bg-muted px-1 rounded">{coop.slug}</code>
                    </TableCell>
                    <TableCell>
                      <Badge variant={coop.plan === 'FREE' ? 'secondary' : 'default'}>
                        {coop.plan}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {coop.subscriptionStatus ? (
                        <Badge variant={coop.subscriptionStatus === 'ACTIVE' ? 'default' : 'secondary'}>
                          {coop.subscriptionStatus}
                        </Badge>
                      ) : coop.trialEndsAt ? (
                        <span className="text-sm text-muted-foreground">
                          Trial ends {formatDate(coop.trialEndsAt)}
                        </span>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={coop.emailEnabled ? 'default' : 'secondary'}>
                        {coop.emailEnabled
                          ? t('system.coops.emailEnabled')
                          : t('system.coops.emailDisabled')}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">{coop.shareholdersCount}</TableCell>
                    <TableCell className="text-right">{fmtCurrency(coop.totalCapital)}</TableCell>
                    <TableCell>{formatDate(coop.createdAt)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="sm" onClick={() => openEditDialog(coop)}>
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button asChild variant="ghost" size="sm">
                          <Link href={`/dashboard/system/coops/${coop.id}/admins`}>
                            <Users className="h-4 w-4" />
                          </Link>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingCoop ? t('system.coops.editCoop') : t('system.coops.addCoop')}
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label>{t('system.coops.coopName')}</Label>
              <Input {...form.register('name')} />
              {form.formState.errors.name && (
                <p className="text-sm text-destructive">{form.formState.errors.name.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label>{t('system.coops.slug')}</Label>
              <Input {...form.register('slug')} placeholder="my-coop" />
              {form.formState.errors.slug && (
                <p className="text-sm text-destructive">{form.formState.errors.slug.message}</p>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                checked={form.watch('emailEnabled')}
                onCheckedChange={(c) => form.setValue('emailEnabled', !!c)}
              />
              <Label>{t('system.coops.emailEnabled')}</Label>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? t('common.loading') : t('common.save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
