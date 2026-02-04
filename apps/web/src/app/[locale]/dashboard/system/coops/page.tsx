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
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import { Plus, Edit, Users } from 'lucide-react';

interface Coop {
  id: string;
  name: string;
  slug: string;
  shareholdersCount: number;
  totalCapital: number;
  createdAt: string;
}

const coopSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  slug: z.string().min(1, 'Slug is required').regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
});

type CoopForm = z.infer<typeof coopSchema>;

export default function CoopsManagementPage() {
  const t = useTranslations();
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
    },
  });

  const fetchCoops = useCallback(async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('accessToken');
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/system/coops`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        // Handle both array and paginated response
        setCoops(Array.isArray(data) ? data : data.data || []);
      }
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
    });
    setDialogOpen(true);
  };

  const openEditDialog = (coop: Coop) => {
    setEditingCoop(coop);
    form.reset({
      name: coop.name,
      slug: coop.slug,
    });
    setDialogOpen(true);
  };

  const onSubmit = async (data: CoopForm) => {
    setSaving(true);
    setError(null);

    try {
      const token = localStorage.getItem('accessToken');
      const url = editingCoop
        ? `${process.env.NEXT_PUBLIC_API_URL}/system/coops/${editingCoop.id}`
        : `${process.env.NEXT_PUBLIC_API_URL}/system/coops`;

      const response = await fetch(url, {
        method: editingCoop ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(data),
      });

      if (response.ok) {
        setSuccess(t('common.success'));
        setDialogOpen(false);
        fetchCoops();
      } else {
        throw new Error('Failed to save');
      }
    } catch {
      setError(t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR' }).format(amount);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('nl-BE');
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
                    <TableCell className="text-right">{coop.shareholdersCount}</TableCell>
                    <TableCell className="text-right">{formatCurrency(coop.totalCapital)}</TableCell>
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
