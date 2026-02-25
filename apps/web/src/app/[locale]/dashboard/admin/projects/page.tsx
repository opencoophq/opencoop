'use client';

import { useEffect, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import { useAdmin } from '@/contexts/admin-context';
import { useLocale } from '@/contexts/locale-context';
import { DatePicker } from '@/components/ui/date-picker';
import { Plus, Edit, Trash2, Sun, Wind } from 'lucide-react';

interface Project {
  id: string;
  name: string;
  description?: string;
  type: 'SOLAR' | 'WIND';
  capacityKw?: number;
  estimatedAnnualMwh?: number;
  startDate?: string;
  endDate?: string;
  isActive: boolean;
  createdAt: string;
}

const projectSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  type: z.enum(['SOLAR', 'WIND']),
  capacityKw: z.coerce.number().min(0).optional().or(z.literal('')),
  estimatedAnnualMwh: z.coerce.number().min(0).optional().or(z.literal('')),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  isActive: z.boolean(),
});

type ProjectForm = z.infer<typeof projectSchema>;

export default function ProjectsPage() {
  const t = useTranslations();
  const { selectedCoop } = useAdmin();
  const { locale } = useLocale();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [saving, setSaving] = useState(false);

  const form = useForm<ProjectForm>({
    resolver: zodResolver(projectSchema),
    defaultValues: {
      name: '',
      description: '',
      type: 'SOLAR',
      capacityKw: '',
      estimatedAnnualMwh: '',
      startDate: '',
      endDate: '',
      isActive: true,
    },
  });

  const fetchProjects = useCallback(async () => {
    if (!selectedCoop) return;

    setLoading(true);
    try {
      const token = localStorage.getItem('accessToken');
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/admin/coops/${selectedCoop.id}/projects`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (response.ok) {
        const data = await response.json();
        setProjects(Array.isArray(data) ? data : data.data || []);
      }
    } catch {
      // Handle error silently
    } finally {
      setLoading(false);
    }
  }, [selectedCoop]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const openCreateDialog = () => {
    setEditingProject(null);
    form.reset({
      name: '',
      description: '',
      type: 'SOLAR',
      capacityKw: '',
      estimatedAnnualMwh: '',
      startDate: '',
      endDate: '',
      isActive: true,
    });
    setDialogOpen(true);
  };

  const openEditDialog = (project: Project) => {
    setEditingProject(project);
    form.reset({
      name: project.name,
      description: project.description || '',
      type: project.type || 'SOLAR',
      capacityKw: project.capacityKw || '',
      estimatedAnnualMwh: project.estimatedAnnualMwh || '',
      startDate: project.startDate ? project.startDate.split('T')[0] : '',
      endDate: project.endDate ? project.endDate.split('T')[0] : '',
      isActive: project.isActive,
    });
    setDialogOpen(true);
  };

  const onSubmit = async (data: ProjectForm) => {
    if (!selectedCoop) return;

    setSaving(true);
    setError(null);

    try {
      const token = localStorage.getItem('accessToken');
      const url = editingProject
        ? `${process.env.NEXT_PUBLIC_API_URL}/admin/coops/${selectedCoop.id}/projects/${editingProject.id}`
        : `${process.env.NEXT_PUBLIC_API_URL}/admin/coops/${selectedCoop.id}/projects`;

      const response = await fetch(url, {
        method: editingProject ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: data.name,
          description: data.description || undefined,
          type: data.type,
          capacityKw: data.capacityKw ? Number(data.capacityKw) : undefined,
          estimatedAnnualMwh: data.estimatedAnnualMwh ? Number(data.estimatedAnnualMwh) : undefined,
          startDate: data.startDate || undefined,
          endDate: data.endDate || undefined,
          isActive: data.isActive,
        }),
      });

      if (response.ok) {
        setSuccess(t('common.success'));
        setDialogOpen(false);
        fetchProjects();
      } else {
        throw new Error('Failed to save');
      }
    } catch {
      setError(t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (project: Project) => {
    if (!confirm(t('common.confirm'))) return;

    try {
      const token = localStorage.getItem('accessToken');
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/admin/coops/${selectedCoop?.id}/projects/${project.id}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (response.ok) {
        setSuccess(t('common.success'));
        fetchProjects();
      } else {
        throw new Error('Failed to delete');
      }
    } catch {
      setError(t('common.error'));
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString(locale);
  };

  const getTypeBadgeVariant = (type: string) => {
    return type === 'SOLAR' ? 'default' : 'secondary';
  };

  const getTypeIcon = (type: string) => {
    return type === 'SOLAR' ? (
      <Sun className="h-4 w-4 mr-1" />
    ) : (
      <Wind className="h-4 w-4 mr-1" />
    );
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="animate-pulse h-8 w-48 bg-muted rounded" />
        <div className="animate-pulse h-64 bg-muted rounded-lg" />
      </div>
    );
  }

  if (!selectedCoop) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">{t('admin.selectCoop')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t('admin.projects.title')}</h1>
        <Button onClick={openCreateDialog}>
          <Plus className="h-4 w-4 mr-2" />
          {t('admin.projects.addProject')}
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
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-12 bg-muted rounded" />
              ))}
            </div>
          ) : projects.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {t('common.noResults')}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('admin.projects.projectName')}</TableHead>
                  <TableHead>{t('admin.projects.type')}</TableHead>
                  <TableHead className="text-right">{t('admin.projects.capacityKw')}</TableHead>
                  <TableHead className="text-right">{t('admin.projects.estimatedMwh')}</TableHead>
                  <TableHead>{t('admin.projects.startDate')}</TableHead>
                  <TableHead>{t('admin.projects.endDate')}</TableHead>
                  <TableHead>{t('admin.projects.status')}</TableHead>
                  <TableHead className="text-right">{t('common.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {projects.map((project) => (
                  <TableRow key={project.id}>
                    <TableCell>
                      <div>
                        <div className="font-medium">{project.name}</div>
                        {project.description && (
                          <div className="text-sm text-muted-foreground truncate max-w-xs">
                            {project.description}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={getTypeBadgeVariant(project.type)} className="flex items-center w-fit">
                        {getTypeIcon(project.type)}
                        {t(`admin.projects.${project.type.toLowerCase()}`)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {project.capacityKw ? `${project.capacityKw} kW` : '-'}
                    </TableCell>
                    <TableCell className="text-right">
                      {project.estimatedAnnualMwh ? `${project.estimatedAnnualMwh} MWh` : '-'}
                    </TableCell>
                    <TableCell>{project.startDate ? formatDate(project.startDate) : '-'}</TableCell>
                    <TableCell>{project.endDate ? formatDate(project.endDate) : '-'}</TableCell>
                    <TableCell>
                      <Badge variant={project.isActive ? 'default' : 'secondary'}>
                        {project.isActive ? t('admin.projects.active') : t('admin.projects.inactive')}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEditDialog(project)}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(project)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
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
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingProject ? t('admin.projects.editProject') : t('admin.projects.addProject')}
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label>{t('admin.projects.projectName')}</Label>
              <Input {...form.register('name')} />
              {form.formState.errors.name && (
                <p className="text-sm text-destructive">{form.formState.errors.name.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label>{t('admin.projects.description')}</Label>
              <Input {...form.register('description')} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t('admin.projects.type')}</Label>
                <Controller
                  name="type"
                  control={form.control}
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="SOLAR">
                          <div className="flex items-center">
                            <Sun className="h-4 w-4 mr-2" />
                            {t('admin.projects.solar')}
                          </div>
                        </SelectItem>
                        <SelectItem value="WIND">
                          <div className="flex items-center">
                            <Wind className="h-4 w-4 mr-2" />
                            {t('admin.projects.wind')}
                          </div>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
              <div className="space-y-2">
                <Label>{t('admin.projects.status')}</Label>
                <Controller
                  name="isActive"
                  control={form.control}
                  render={({ field }) => (
                    <Select
                      value={field.value ? 'active' : 'inactive'}
                      onValueChange={(v) => field.onChange(v === 'active')}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">{t('admin.projects.active')}</SelectItem>
                        <SelectItem value="inactive">{t('admin.projects.inactive')}</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t('admin.projects.capacityKw')}</Label>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="250"
                  {...form.register('capacityKw')}
                />
              </div>
              <div className="space-y-2">
                <Label>{t('admin.projects.estimatedMwh')}</Label>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="300"
                  {...form.register('estimatedAnnualMwh')}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t('admin.projects.startDate')}</Label>
                <Controller
                  name="startDate"
                  control={form.control}
                  render={({ field }) => (
                    <DatePicker
                      value={field.value}
                      onChange={field.onChange}
                      placeholder={t('common.selectDate')}
                    />
                  )}
                />
              </div>
              <div className="space-y-2">
                <Label>
                  {t('admin.projects.endDate')}
                  <span className="text-muted-foreground ml-1">({t('common.optional')})</span>
                </Label>
                <Controller
                  name="endDate"
                  control={form.control}
                  render={({ field }) => (
                    <DatePicker
                      value={field.value}
                      onChange={field.onChange}
                      placeholder={t('common.selectDate')}
                    />
                  )}
                />
              </div>
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
