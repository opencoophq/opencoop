'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAdmin } from '@/contexts/admin-context';
import { Link } from '@/i18n/routing';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { Plus, Pencil, Trash2, ArrowLeft, Lock, Users } from 'lucide-react';

const PERMISSION_KEYS = [
  'canManageShareholders',
  'canManageTransactions',
  'canManageShareClasses',
  'canManageProjects',
  'canManageDividends',
  'canManageMessages',
  'canManageSettings',
  'canManageAdmins',
  'canViewPII',
  'canViewReports',
  'canViewShareholderRegister',
] as const;

type PermissionKey = (typeof PERMISSION_KEYS)[number];

interface Permissions {
  canManageShareholders: boolean;
  canManageTransactions: boolean;
  canManageShareClasses: boolean;
  canManageProjects: boolean;
  canManageDividends: boolean;
  canManageMessages: boolean;
  canManageSettings: boolean;
  canManageAdmins: boolean;
  canViewPII: boolean;
  canViewReports: boolean;
  canViewShareholderRegister: boolean;
}

interface Role {
  id: string;
  name: string;
  permissions: Permissions;
  isDefault: boolean;
  _count?: { coopAdmins: number };
}

const DEFAULT_PERMISSIONS: Permissions = {
  canManageShareholders: false,
  canManageTransactions: false,
  canManageShareClasses: false,
  canManageProjects: false,
  canManageDividends: false,
  canManageMessages: false,
  canManageSettings: false,
  canManageAdmins: false,
  canViewPII: false,
  canViewReports: false,
  canViewShareholderRegister: false,
};

export default function RolesPage() {
  const t = useTranslations('admin');
  const tp = useTranslations('admin.permissions');
  const tc = useTranslations('common');
  const { selectedCoop } = useAdmin();

  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [roleName, setRoleName] = useState('');
  const [permissions, setPermissions] = useState<Permissions>(DEFAULT_PERMISSIONS);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [roleToDelete, setRoleToDelete] = useState<Role | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const coopId = selectedCoop?.id;

  const loadRoles = async () => {
    if (!coopId) return;
    setLoading(true);
    try {
      const data = await api<Role[]>(`/admin/coops/${coopId}/team/roles`);
      setRoles(data);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRoles();
  }, [coopId]);

  const openCreate = () => {
    setEditingRole(null);
    setRoleName('');
    setPermissions(DEFAULT_PERMISSIONS);
    setError('');
    setDialogOpen(true);
  };

  const openEdit = (role: Role) => {
    setEditingRole(role);
    setRoleName(role.name);
    setPermissions({ ...DEFAULT_PERMISSIONS, ...role.permissions });
    setError('');
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!coopId || !roleName.trim()) return;
    setSaving(true);
    setError('');
    try {
      if (editingRole) {
        await api(`/admin/coops/${coopId}/team/roles/${editingRole.id}`, {
          method: 'PUT',
          body: { name: roleName, permissions },
        });
      } else {
        await api(`/admin/coops/${coopId}/team/roles`, {
          method: 'POST',
          body: { name: roleName, permissions },
        });
      }
      setDialogOpen(false);
      loadRoles();
    } catch (err: any) {
      setError(err.message || 'Failed to save role');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!coopId || !roleToDelete) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await api(`/admin/coops/${coopId}/team/roles/${roleToDelete.id}`, {
        method: 'DELETE',
      });
      setDeleteOpen(false);
      setRoleToDelete(null);
      loadRoles();
    } catch (err: any) {
      setDeleteError(err.message || 'Failed to delete role');
    } finally {
      setDeleting(false);
    }
  };

  const togglePermission = (key: PermissionKey) => {
    setPermissions((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const countEnabled = (perms: Permissions) =>
    PERMISSION_KEYS.filter((k) => perms[k]).length;

  if (!selectedCoop) {
    return <p className="text-muted-foreground">{t('selectCoop')}</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/admin/team">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <h1 className="text-2xl font-bold">{t('team.roles.title')}</h1>
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="h-4 w-4 mr-2" />
          {t('team.roles.createRole')}
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : (
        <div className="grid gap-4">
          {roles.map((role) => (
            <Card key={role.id}>
              <CardContent className="flex items-center justify-between py-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{role.name}</span>
                    {role.isDefault && (
                      <Badge variant="secondary" className="text-xs">
                        <Lock className="h-3 w-3 mr-1" />
                        {t('team.roles.defaultRole')}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-sm text-muted-foreground">
                    <span>
                      {countEnabled(role.permissions)}/{PERMISSION_KEYS.length} {t('team.roles.permissions').toLowerCase()}
                    </span>
                    <span className="flex items-center gap-1">
                      <Users className="h-3 w-3" />
                      {t('team.roles.adminCount', { count: role._count?.coopAdmins || 0 })}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="icon" onClick={() => openEdit(role)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  {!role.isDefault && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive"
                      onClick={() => {
                        setRoleToDelete(role);
                        setDeleteError('');
                        setDeleteOpen(true);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create/Edit role dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingRole ? t('team.roles.editRole') : t('team.roles.createRole')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>{t('team.roles.roleName')}</Label>
              <Input
                value={roleName}
                onChange={(e) => setRoleName(e.target.value)}
                placeholder={t('team.roles.roleName')}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('team.roles.permissions')}</Label>
              <div className="space-y-2 border rounded-md p-3">
                {PERMISSION_KEYS.map((key) => (
                  <label
                    key={key}
                    className="flex items-center gap-3 py-1 cursor-pointer"
                  >
                    <Checkbox
                      checked={permissions[key]}
                      onCheckedChange={() => togglePermission(key)}
                    />
                    <span className="text-sm">{tp(key)}</span>
                  </label>
                ))}
              </div>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {tc('cancel')}
            </Button>
            <Button onClick={handleSave} disabled={saving || !roleName.trim()}>
              {tc('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('team.roles.deleteRole')}</DialogTitle>
            <DialogDescription>{t('team.roles.deleteConfirm')}</DialogDescription>
          </DialogHeader>
          {deleteError && (
            <p className="text-sm text-destructive py-2">{deleteError}</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              {tc('cancel')}
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {tc('delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
