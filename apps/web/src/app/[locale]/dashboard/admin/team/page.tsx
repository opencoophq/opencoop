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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
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
import { Checkbox } from '@/components/ui/checkbox';
import { api } from '@/lib/api';
import { UserPlus, Trash2, Settings, Mail, X, Shield } from 'lucide-react';

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

interface Admin {
  id: string;
  user: { id: string; name: string | null; email: string };
  role: { id: string; name: string; permissions: Record<string, boolean> };
  permissionOverrides: Record<string, boolean> | null;
  createdAt: string;
}

interface Role {
  id: string;
  name: string;
  isDefault: boolean;
  _count?: { coopAdmins: number };
}

interface Invitation {
  id: string;
  email: string;
  role: { id: string; name: string };
  expiresAt: string;
  createdAt: string;
}

export default function TeamPage() {
  const t = useTranslations('admin');
  const tc = useTranslations('common');
  const { selectedCoop } = useAdmin();

  const [admins, setAdmins] = useState<Admin[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRoleId, setInviteRoleId] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState('');

  const [removeOpen, setRemoveOpen] = useState(false);
  const [adminToRemove, setAdminToRemove] = useState<Admin | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState('');

  const [permsOpen, setPermsOpen] = useState(false);
  const [permsAdmin, setPermsAdmin] = useState<Admin | null>(null);
  const [permsOverrides, setPermsOverrides] = useState<Record<string, boolean | undefined>>({});
  const [permsSaving, setPermsSaving] = useState(false);

  const coopId = selectedCoop?.id;

  const loadData = async () => {
    if (!coopId) return;
    setLoading(true);
    try {
      const [adminsData, rolesData, invitationsData] = await Promise.all([
        api<Admin[]>(`/admin/coops/${coopId}/team`),
        api<Role[]>(`/admin/coops/${coopId}/team/roles`),
        api<Invitation[]>(`/admin/coops/${coopId}/team/invitations`),
      ]);
      setAdmins(adminsData);
      setRoles(rolesData);
      setInvitations(invitationsData);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [coopId]);

  const handleInvite = async () => {
    if (!coopId || !inviteEmail || !inviteRoleId) return;
    setInviting(true);
    setInviteError('');
    try {
      await api(`/admin/coops/${coopId}/team/invite`, {
        method: 'POST',
        body: { email: inviteEmail, roleId: inviteRoleId },
      });
      setInviteOpen(false);
      setInviteEmail('');
      setInviteRoleId('');
      loadData();
    } catch (err: any) {
      setInviteError(err.message || 'Failed to send invitation');
    } finally {
      setInviting(false);
    }
  };

  const handleRoleChange = async (adminId: string, roleId: string) => {
    if (!coopId) return;
    try {
      await api(`/admin/coops/${coopId}/team/${adminId}/role`, {
        method: 'PUT',
        body: { roleId },
      });
      loadData();
    } catch {
      // silently fail
    }
  };

  const handleRemove = async () => {
    if (!coopId || !adminToRemove) return;
    setRemoving(true);
    setRemoveError('');
    try {
      await api(`/admin/coops/${coopId}/team/${adminToRemove.id}`, {
        method: 'DELETE',
      });
      setRemoveOpen(false);
      setAdminToRemove(null);
      loadData();
    } catch (err: any) {
      setRemoveError(err.message || 'Failed to remove admin');
    } finally {
      setRemoving(false);
    }
  };

  const openPermsDialog = (admin: Admin) => {
    setPermsAdmin(admin);
    setPermsOverrides(admin.permissionOverrides ?? {});
    setPermsOpen(true);
  };

  const togglePermOverride = (key: PermissionKey) => {
    if (!permsAdmin) return;
    const roleValue = permsAdmin.role.permissions[key] ?? false;
    const hasOverride = permsOverrides[key] !== undefined;
    const effectiveValue = hasOverride ? permsOverrides[key] : roleValue;
    const newValue = !effectiveValue;

    if (newValue === roleValue) {
      // Matches role default → remove override
      setPermsOverrides((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    } else {
      // Differs from role → create override
      setPermsOverrides((prev) => ({ ...prev, [key]: newValue }));
    }
  };

  const handleSavePerms = async () => {
    if (!coopId || !permsAdmin) return;
    setPermsSaving(true);
    try {
      const hasOverrides = Object.keys(permsOverrides).length > 0;
      await api(`/admin/coops/${coopId}/team/${permsAdmin.id}/permissions`, {
        method: 'PUT',
        body: { permissionOverrides: hasOverrides ? permsOverrides : null },
      });
      setPermsOpen(false);
      loadData();
    } catch {
      // silently fail
    } finally {
      setPermsSaving(false);
    }
  };

  const handleRevokeInvitation = async (invitationId: string) => {
    if (!coopId) return;
    try {
      await api(`/admin/coops/${coopId}/team/invitations/${invitationId}`, {
        method: 'DELETE',
      });
      loadData();
    } catch {
      // silently fail
    }
  };

  if (!selectedCoop) {
    return <p className="text-muted-foreground">{t('selectCoop')}</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t('team.title')}</h1>
        <div className="flex gap-2">
          <Link href="/dashboard/admin/team/roles">
            <Button variant="outline" size="sm">
              <Settings className="h-4 w-4 mr-2" />
              {t('team.roles.title')}
            </Button>
          </Link>
          <Button size="sm" onClick={() => setInviteOpen(true)}>
            <UserPlus className="h-4 w-4 mr-2" />
            {t('team.inviteAdmin')}
          </Button>
        </div>
      </div>

      {/* Admins list */}
      <Card>
        <CardHeader>
          <CardTitle>{t('team.admins')}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
            </div>
          ) : admins.length === 0 ? (
            <p className="text-muted-foreground text-sm py-4">{t('team.noAdmins')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tc('name')}</TableHead>
                  <TableHead>{tc('email')}</TableHead>
                  <TableHead>{t('team.role')}</TableHead>
                  <TableHead>{tc('date')}</TableHead>
                  <TableHead className="w-[80px]">{tc('actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {admins.map((admin) => (
                  <TableRow key={admin.id}>
                    <TableCell className="font-medium">
                      {admin.user.name || '-'}
                    </TableCell>
                    <TableCell>{admin.user.email}</TableCell>
                    <TableCell>
                      <Select
                        value={admin.role.id}
                        onValueChange={(value) => handleRoleChange(admin.id, value)}
                      >
                        <SelectTrigger className="w-[160px] h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {roles.map((role) => (
                            <SelectItem key={role.id} value={role.id}>
                              {role.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {new Date(admin.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          title={t('team.customPermissions')}
                          onClick={() => openPermsDialog(admin)}
                        >
                          <Shield className={`h-4 w-4 ${admin.permissionOverrides ? 'text-primary' : ''}`} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive"
                          onClick={() => {
                            setAdminToRemove(admin);
                            setRemoveOpen(true);
                            setRemoveError('');
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
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

      {/* Pending invitations */}
      {invitations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t('team.pendingInvitations')}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tc('email')}</TableHead>
                  <TableHead>{t('team.role')}</TableHead>
                  <TableHead>{t('team.expiresAt')}</TableHead>
                  <TableHead className="w-[80px]">{tc('actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invitations.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <Mail className="h-4 w-4 text-muted-foreground" />
                        {inv.email}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{inv.role.name}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {new Date(inv.expiresAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive"
                        onClick={() => handleRevokeInvitation(inv.id)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Invite dialog */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('team.inviteAdmin')}</DialogTitle>
            <DialogDescription>{t('team.inviteDescription')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>{t('team.email')}</Label>
              <Input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="admin@coop.be"
              />
            </div>
            <div className="space-y-2">
              <Label>{t('team.role')}</Label>
              <Select value={inviteRoleId} onValueChange={setInviteRoleId}>
                <SelectTrigger>
                  <SelectValue placeholder={t('team.role')} />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((role) => (
                    <SelectItem key={role.id} value={role.id}>
                      {role.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {inviteError && (
              <p className="text-sm text-destructive">{inviteError}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteOpen(false)}>
              {tc('cancel')}
            </Button>
            <Button
              onClick={handleInvite}
              disabled={inviting || !inviteEmail || !inviteRoleId}
            >
              {t('team.sendInvitation')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove confirmation dialog */}
      <Dialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('team.removeAdmin')}</DialogTitle>
            <DialogDescription>{t('team.removeConfirm')}</DialogDescription>
          </DialogHeader>
          {removeError && (
            <p className="text-sm text-destructive py-2">{removeError}</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoveOpen(false)}>
              {tc('cancel')}
            </Button>
            <Button variant="destructive" onClick={handleRemove} disabled={removing}>
              {tc('delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Per-user permission overrides dialog */}
      <Dialog open={permsOpen} onOpenChange={setPermsOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('team.customPermissions')}</DialogTitle>
            <DialogDescription>
              {t('team.customPermissionsDescription', { name: permsAdmin?.user.name || permsAdmin?.user.email || '' })}
            </DialogDescription>
          </DialogHeader>
          {permsAdmin && (
            <div className="space-y-2 border rounded-md p-3 max-h-[400px] overflow-y-auto">
              {PERMISSION_KEYS.map((key) => {
                const roleValue = permsAdmin.role.permissions[key] ?? false;
                const hasOverride = permsOverrides[key] !== undefined;
                const effectiveValue = hasOverride ? permsOverrides[key] : roleValue;

                return (
                  <label
                    key={key}
                    className="flex items-center gap-3 py-1 cursor-pointer"
                  >
                    <Checkbox
                      checked={effectiveValue}
                      onCheckedChange={() => togglePermOverride(key)}
                    />
                    <span className={`text-sm flex-1 ${hasOverride ? 'font-medium' : ''}`}>
                      {t(`permissions.${key}`)}
                    </span>
                    {hasOverride && (
                      <Badge variant="outline" className="text-xs">
                        {t('team.overridden')}
                      </Badge>
                    )}
                  </label>
                );
              })}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            {t('team.overrideHint')}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPermsOpen(false)}>
              {tc('cancel')}
            </Button>
            <Button onClick={handleSavePerms} disabled={permsSaving}>
              {tc('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
