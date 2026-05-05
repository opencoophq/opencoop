'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
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
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
} from '@/components/ui/dropdown-menu';
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
import {
  applyColumnFiltersAndSort,
  toggleColumnSort,
  type ColumnSortState,
} from '@/lib/table-utils';
import {
  UserPlus,
  Trash2,
  Settings,
  Mail,
  Send,
  X,
  Shield,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronDown,
  Check,
  Pencil,
} from 'lucide-react';

const PERMISSION_KEYS = [
  'canManageShareholders',
  'canManageTransactions',
  'canManageShareClasses',
  'canManageProjects',
  'canManageDividends',
  'canManageMessages',
  'canManageMeetings',
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
  // An admin has N roles. Effective permissions are the union (OR-merge)
  // of every assigned role's `permissions`, with `permissionOverrides`
  // applied on top. The auth service does the same merge at JWT-issue
  // time — keep both implementations in sync.
  roles: { role: { id: string; name: string; permissions: Record<string, boolean> } }[];
  permissionOverrides: Record<string, boolean> | null;
  createdAt: string;
}

/**
 * OR-merge `permissions` across every role assigned to an admin. Returns
 * the effective base value for a given permission key — `true` if ANY
 * role grants it, `false` otherwise. Per-admin overrides are applied
 * separately by the caller.
 */
function getBasePermission(admin: Admin, key: string): boolean {
  return admin.roles.some((r) => r.role.permissions[key] === true);
}

interface Role {
  id: string;
  name: string;
  isDefault: boolean;
  _count?: { coopAdminRoles: number };
}

interface Invitation {
  id: string;
  email: string;
  roles: { role: { id: string; name: string } }[];
  expiresAt: string;
  createdAt: string;
}

type AdminColumn = 'name' | 'email' | 'role' | 'date';
type InvitationColumn = 'email' | 'role' | 'expiresAt';

export default function TeamPage() {
  const t = useTranslations('admin');
  const tc = useTranslations('common');
  const { selectedCoop } = useAdmin();

  const [admins, setAdmins] = useState<Admin[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [adminFilters, setAdminFilters] = useState<Partial<Record<AdminColumn, string>>>({});
  const [adminSort, setAdminSort] = useState<ColumnSortState<AdminColumn>>({
    column: null,
    direction: 'asc',
  });
  const [invitationFilters, setInvitationFilters] = useState<Partial<Record<InvitationColumn, string>>>({});
  const [invitationSort, setInvitationSort] = useState<ColumnSortState<InvitationColumn>>({
    column: null,
    direction: 'asc',
  });

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRoleIds, setInviteRoleIds] = useState<string[]>([]);
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

  const [resendingId, setResendingId] = useState<string | null>(null);
  const [resentId, setResentId] = useState<string | null>(null);

  const [editUserOpen, setEditUserOpen] = useState(false);
  const [editUserAdmin, setEditUserAdmin] = useState<Admin | null>(null);
  const [editUserName, setEditUserName] = useState('');
  const [editUserEmail, setEditUserEmail] = useState('');
  const [editUserLanguage, setEditUserLanguage] = useState('nl');
  const [editUserSaving, setEditUserSaving] = useState(false);
  const [editUserError, setEditUserError] = useState('');

  const coopId = selectedCoop?.id;

  const visibleAdmins = useMemo(
    () =>
      applyColumnFiltersAndSort(
        admins,
        {
          name: { accessor: (admin) => admin.user.name || '' },
          email: { accessor: (admin) => admin.user.email },
          role: { accessor: (admin) => admin.roles.map((r) => r.role.name).join(', ') },
          date: { accessor: (admin) => admin.createdAt },
        },
        adminFilters,
        adminSort,
      ),
    [admins, adminFilters, adminSort],
  );

  const visibleInvitations = useMemo(
    () =>
      applyColumnFiltersAndSort(
        invitations,
        {
          email: { accessor: (inv) => inv.email },
          role: { accessor: (inv) => inv.roles.map((r) => r.role.name).join(', ') },
          expiresAt: { accessor: (inv) => inv.expiresAt },
        },
        invitationFilters,
        invitationSort,
      ),
    [invitations, invitationFilters, invitationSort],
  );

  const sortIcon = (active: boolean, direction: 'asc' | 'desc') => {
    if (!active) return <ArrowUpDown className="h-4 w-4 ml-1" />;
    return direction === 'asc' ? (
      <ArrowUp className="h-4 w-4 ml-1" />
    ) : (
      <ArrowDown className="h-4 w-4 ml-1" />
    );
  };

  const loadData = useCallback(async () => {
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
  }, [coopId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleInvite = async () => {
    if (!coopId || !inviteEmail || inviteRoleIds.length === 0) return;
    setInviting(true);
    setInviteError('');
    try {
      await api(`/admin/coops/${coopId}/team/invite`, {
        method: 'POST',
        body: { email: inviteEmail, roleIds: inviteRoleIds },
      });
      setInviteOpen(false);
      setInviteEmail('');
      setInviteRoleIds([]);
      loadData();
    } catch (err: any) {
      setInviteError(err.message || 'Failed to send invitation');
    } finally {
      setInviting(false);
    }
  };

  const toggleInviteRole = (roleId: string) => {
    setInviteRoleIds((prev) =>
      prev.includes(roleId) ? prev.filter((id) => id !== roleId) : [...prev, roleId],
    );
  };

  const handleUpdateInvitationRoles = async (invitationId: string, roleIds: string[]) => {
    if (!coopId || roleIds.length === 0) return;
    try {
      await api(`/admin/coops/${coopId}/team/invitations/${invitationId}/roles`, {
        method: 'PUT',
        body: { roleIds },
      });
      loadData();
    } catch {
      // silently fail
    }
  };

  const toggleInvitationRole = (inv: Invitation, roleId: string) => {
    const currentIds = inv.roles.map((r) => r.role.id);
    const next = currentIds.includes(roleId)
      ? currentIds.filter((id) => id !== roleId)
      : [...currentIds, roleId];
    if (next.length === 0) return; // backend rejects empty
    handleUpdateInvitationRoles(inv.id, next);
  };

  const handleRolesChange = async (adminId: string, roleIds: string[]) => {
    if (!coopId) return;
    if (roleIds.length === 0) return; // backend enforces ≥1 role; UI guard avoids the round-trip
    try {
      await api(`/admin/coops/${coopId}/team/${adminId}/roles`, {
        method: 'PUT',
        body: { roleIds },
      });
      loadData();
    } catch {
      // silently fail
    }
  };

  const toggleAdminRole = (admin: Admin, roleId: string) => {
    const currentIds = admin.roles.map((r) => r.role.id);
    const next = currentIds.includes(roleId)
      ? currentIds.filter((id) => id !== roleId)
      : [...currentIds, roleId];
    if (next.length === 0) return; // can't unassign the last role
    handleRolesChange(admin.id, next);
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
    const roleValue = getBasePermission(permsAdmin, key);
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

  const openEditUserDialog = (admin: Admin) => {
    setEditUserAdmin(admin);
    setEditUserName(admin.user.name ?? '');
    setEditUserEmail(admin.user.email);
    // The admin row doesn't include preferredLanguage in the API
    // response — default to 'nl' for the form. The backend only updates
    // fields that were sent, so leaving it untouched is safe.
    setEditUserLanguage('nl');
    setEditUserError('');
    setEditUserOpen(true);
  };

  const handleSaveEditUser = async () => {
    if (!coopId || !editUserAdmin) return;
    setEditUserSaving(true);
    setEditUserError('');
    try {
      const body: Record<string, unknown> = {};
      if (editUserName !== (editUserAdmin.user.name ?? '')) body.name = editUserName || null;
      if (editUserEmail.toLowerCase() !== editUserAdmin.user.email.toLowerCase()) {
        body.email = editUserEmail;
      }
      // Always send preferredLanguage (form default may differ from
      // current value; backend only writes when supplied).
      body.preferredLanguage = editUserLanguage;
      await api(`/admin/coops/${coopId}/team/${editUserAdmin.id}/user`, {
        method: 'PATCH',
        body,
      });
      setEditUserOpen(false);
      loadData();
    } catch (err: any) {
      setEditUserError(err.message || 'Failed to update user');
    } finally {
      setEditUserSaving(false);
    }
  };

  const handleResendInvitation = async (invitationId: string) => {
    if (!coopId || resendingId) return;
    setResendingId(invitationId);
    try {
      await api(`/admin/coops/${coopId}/team/invitations/${invitationId}/resend`, {
        method: 'POST',
      });
      setResentId(invitationId);
      // Briefly show a checkmark, then refresh the list to pick up the
      // new expiresAt the backend just set.
      setTimeout(() => {
        setResentId((id) => (id === invitationId ? null : id));
        loadData();
      }, 1500);
    } catch {
      // silently fail
    } finally {
      setResendingId(null);
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
                  <TableHead>
                    <Button variant="ghost" size="sm" onClick={() => setAdminSort((prev) => toggleColumnSort(prev, 'name'))}>
                      {tc('name')}
                      {sortIcon(adminSort.column === 'name', adminSort.direction)}
                    </Button>
                  </TableHead>
                  <TableHead>
                    <Button variant="ghost" size="sm" onClick={() => setAdminSort((prev) => toggleColumnSort(prev, 'email'))}>
                      {tc('email')}
                      {sortIcon(adminSort.column === 'email', adminSort.direction)}
                    </Button>
                  </TableHead>
                  <TableHead>
                    <Button variant="ghost" size="sm" onClick={() => setAdminSort((prev) => toggleColumnSort(prev, 'role'))}>
                      {t('team.role')}
                      {sortIcon(adminSort.column === 'role', adminSort.direction)}
                    </Button>
                  </TableHead>
                  <TableHead>
                    <Button variant="ghost" size="sm" onClick={() => setAdminSort((prev) => toggleColumnSort(prev, 'date'))}>
                      {tc('date')}
                      {sortIcon(adminSort.column === 'date', adminSort.direction)}
                    </Button>
                  </TableHead>
                  <TableHead className="w-[80px]">{tc('actions')}</TableHead>
                </TableRow>
                <TableRow>
                  <TableHead>
                    <Input
                      value={adminFilters.name || ''}
                      onChange={(e) => setAdminFilters((prev) => ({ ...prev, name: e.target.value }))}
                      placeholder={tc('filter')}
                      className="h-8"
                    />
                  </TableHead>
                  <TableHead>
                    <Input
                      value={adminFilters.email || ''}
                      onChange={(e) => setAdminFilters((prev) => ({ ...prev, email: e.target.value }))}
                      placeholder={tc('filter')}
                      className="h-8"
                    />
                  </TableHead>
                  <TableHead>
                    <Input
                      value={adminFilters.role || ''}
                      onChange={(e) => setAdminFilters((prev) => ({ ...prev, role: e.target.value }))}
                      placeholder={tc('filter')}
                      className="h-8"
                    />
                  </TableHead>
                  <TableHead>
                    <Input
                      value={adminFilters.date || ''}
                      onChange={(e) => setAdminFilters((prev) => ({ ...prev, date: e.target.value }))}
                      placeholder={tc('filter')}
                      className="h-8"
                    />
                  </TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleAdmins.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-6">
                      {tc('noResults')}
                    </TableCell>
                  </TableRow>
                ) : (
                  visibleAdmins.map((admin) => (
                    <TableRow key={admin.id}>
                      <TableCell className="font-medium">
                        {admin.user.name || '-'}
                      </TableCell>
                      <TableCell>{admin.user.email}</TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="sm" className="w-[200px] h-8 justify-between font-normal">
                              <span className="truncate">
                                {admin.roles.length > 0
                                  ? admin.roles.map((r) => r.role.name).join(', ')
                                  : '—'}
                              </span>
                              <ChevronDown className="h-4 w-4 ml-1 flex-shrink-0" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start">
                            {roles.map((role) => {
                              const checked = admin.roles.some((r) => r.role.id === role.id);
                              const isOnlyRole = checked && admin.roles.length === 1;
                              return (
                                <DropdownMenuCheckboxItem
                                  key={role.id}
                                  checked={checked}
                                  // Block unticking the last role — admin
                                  // must always have at least one (backend
                                  // also enforces this).
                                  disabled={isOnlyRole}
                                  onCheckedChange={() => toggleAdminRole(admin, role.id)}
                                >
                                  {role.name}
                                </DropdownMenuCheckboxItem>
                              );
                            })}
                          </DropdownMenuContent>
                        </DropdownMenu>
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
                            title={t('team.editUser')}
                            onClick={() => openEditUserDialog(admin)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
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
                  ))
                )}
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
                  <TableHead>
                    <Button variant="ghost" size="sm" onClick={() => setInvitationSort((prev) => toggleColumnSort(prev, 'email'))}>
                      {tc('email')}
                      {sortIcon(invitationSort.column === 'email', invitationSort.direction)}
                    </Button>
                  </TableHead>
                  <TableHead>
                    <Button variant="ghost" size="sm" onClick={() => setInvitationSort((prev) => toggleColumnSort(prev, 'role'))}>
                      {t('team.role')}
                      {sortIcon(invitationSort.column === 'role', invitationSort.direction)}
                    </Button>
                  </TableHead>
                  <TableHead>
                    <Button variant="ghost" size="sm" onClick={() => setInvitationSort((prev) => toggleColumnSort(prev, 'expiresAt'))}>
                      {t('team.expiresAt')}
                      {sortIcon(invitationSort.column === 'expiresAt', invitationSort.direction)}
                    </Button>
                  </TableHead>
                  <TableHead className="w-[80px]">{tc('actions')}</TableHead>
                </TableRow>
                <TableRow>
                  <TableHead>
                    <Input
                      value={invitationFilters.email || ''}
                      onChange={(e) => setInvitationFilters((prev) => ({ ...prev, email: e.target.value }))}
                      placeholder={tc('filter')}
                      className="h-8"
                    />
                  </TableHead>
                  <TableHead>
                    <Input
                      value={invitationFilters.role || ''}
                      onChange={(e) => setInvitationFilters((prev) => ({ ...prev, role: e.target.value }))}
                      placeholder={tc('filter')}
                      className="h-8"
                    />
                  </TableHead>
                  <TableHead>
                    <Input
                      value={invitationFilters.expiresAt || ''}
                      onChange={(e) => setInvitationFilters((prev) => ({ ...prev, expiresAt: e.target.value }))}
                      placeholder={tc('filter')}
                      className="h-8"
                    />
                  </TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleInvitations.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-6">
                      {tc('noResults')}
                    </TableCell>
                  </TableRow>
                ) : (
                  visibleInvitations.map((inv) => (
                    <TableRow key={inv.id}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <Mail className="h-4 w-4 text-muted-foreground" />
                          {inv.email}
                        </div>
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="sm" className="w-[200px] h-8 justify-between font-normal">
                              <span className="truncate">
                                {inv.roles.length > 0
                                  ? inv.roles.map((r) => r.role.name).join(', ')
                                  : '—'}
                              </span>
                              <ChevronDown className="h-4 w-4 ml-1 flex-shrink-0" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start">
                            {roles.map((role) => {
                              const checked = inv.roles.some((r) => r.role.id === role.id);
                              const isOnlyRole = checked && inv.roles.length === 1;
                              return (
                                <DropdownMenuCheckboxItem
                                  key={role.id}
                                  checked={checked}
                                  disabled={isOnlyRole}
                                  onCheckedChange={() => toggleInvitationRole(inv, role.id)}
                                >
                                  {role.name}
                                </DropdownMenuCheckboxItem>
                              );
                            })}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {new Date(inv.expiresAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            title={t('team.resend')}
                            disabled={resendingId === inv.id}
                            onClick={() => handleResendInvitation(inv.id)}
                          >
                            {resentId === inv.id ? (
                              <Check className="h-4 w-4 text-green-600" />
                            ) : (
                              <Send className="h-4 w-4" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive"
                            title={t('team.revoke')}
                            onClick={() => handleRevokeInvitation(inv.id)}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
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
              <Label>{t('team.roles.title')}</Label>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="w-full justify-between font-normal">
                    <span className="truncate">
                      {inviteRoleIds.length > 0
                        ? roles
                            .filter((r) => inviteRoleIds.includes(r.id))
                            .map((r) => r.name)
                            .join(', ')
                        : t('team.role')}
                    </span>
                    <ChevronDown className="h-4 w-4 ml-1 flex-shrink-0" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)]">
                  {roles.map((role) => (
                    <DropdownMenuCheckboxItem
                      key={role.id}
                      checked={inviteRoleIds.includes(role.id)}
                      onCheckedChange={() => toggleInviteRole(role.id)}
                    >
                      {role.name}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
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
              disabled={inviting || !inviteEmail || inviteRoleIds.length === 0}
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

      {/* Edit team member user dialog */}
      <Dialog open={editUserOpen} onOpenChange={setEditUserOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('team.editUser')}</DialogTitle>
            <DialogDescription>{t('team.editUserDescription')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>{t('team.name')}</Label>
              <Input value={editUserName} onChange={(e) => setEditUserName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>{t('team.email')}</Label>
              <Input
                type="email"
                value={editUserEmail}
                onChange={(e) => setEditUserEmail(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {t('team.emailChangeWarning')}
              </p>
            </div>
            <div className="space-y-2">
              <Label>{t('team.preferredLanguage')}</Label>
              <Select value={editUserLanguage} onValueChange={setEditUserLanguage}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="nl">Nederlands</SelectItem>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="fr">Français</SelectItem>
                  <SelectItem value="de">Deutsch</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {editUserError && <p className="text-sm text-destructive">{editUserError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditUserOpen(false)}>
              {tc('cancel')}
            </Button>
            <Button onClick={handleSaveEditUser} disabled={editUserSaving}>
              {tc('save')}
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
                const roleValue = getBasePermission(permsAdmin, key);
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
