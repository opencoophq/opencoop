'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useLocale } from '@/contexts/locale-context';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/lib/api';

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  role: string;
  preferredLanguage: string;
  emailVerified: string | null;
  createdAt: string;
  coopAdminOf: Array<{ coop: { name: string; slug: string } }>;
}

export default function SystemUsersPage() {
  const t = useTranslations();
  const { locale } = useLocale();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);

  const loadUsers = () => {
    setLoading(true);
    api<UserRow[]>('/system/users')
      .then(setUsers)
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadUsers(); }, []);

  const handleRoleChange = async (userId: string, role: string) => {
    await api(`/system/users/${userId}/role`, { method: 'PUT', body: { role } });
    loadUsers();
  };

  const roleVariant = (role: string) => {
    switch (role) {
      case 'SYSTEM_ADMIN': return 'destructive';
      case 'COOP_ADMIN': return 'default';
      default: return 'secondary';
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">{t('system.users.title')}</h1>
      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>
          ) : users.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">{t('common.noResults')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('common.name')}</TableHead>
                  <TableHead>{t('common.email')}</TableHead>
                  <TableHead>{t('system.users.role')}</TableHead>
                  <TableHead>{t('system.users.adminOf')}</TableHead>
                  <TableHead>{t('common.verified')}</TableHead>
                  <TableHead>{t('common.date')}</TableHead>
                  <TableHead>{t('common.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell>{user.name || '-'}</TableCell>
                    <TableCell className="font-medium">{user.email}</TableCell>
                    <TableCell>
                      <Badge variant={roleVariant(user.role)}>{t(`system.users.roles.${user.role}`)}</Badge>
                    </TableCell>
                    <TableCell>
                      {user.coopAdminOf.map((ca) => ca.coop.name).join(', ') || '-'}
                    </TableCell>
                    <TableCell>{user.emailVerified ? '✓' : '-'}</TableCell>
                    <TableCell>{new Date(user.createdAt).toLocaleDateString(locale)}</TableCell>
                    <TableCell>
                      <Select value={user.role} onValueChange={(v) => handleRoleChange(user.id, v)}>
                        <SelectTrigger className="w-[160px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="SHAREHOLDER">{t('system.users.roles.SHAREHOLDER')}</SelectItem>
                          <SelectItem value="COOP_ADMIN">{t('system.users.roles.COOP_ADMIN')}</SelectItem>
                          <SelectItem value="SYSTEM_ADMIN">{t('system.users.roles.SYSTEM_ADMIN')}</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
