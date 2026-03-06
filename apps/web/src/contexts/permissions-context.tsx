'use client';

import { createContext, useContext, useMemo, useCallback } from 'react';
import { useAdmin } from './admin-context';

interface CoopPermissions {
  canManageShareholders: boolean;
  canManageTransactions: boolean;
  canManageShareClasses: boolean;
  canManageProjects: boolean;
  canManageDividends: boolean;
  canManageSettings: boolean;
  canManageAdmins: boolean;
  canViewPII: boolean;
  canViewReports: boolean;
  canViewShareholderRegister: boolean;
}

type CoopPermissionKey = keyof CoopPermissions;

interface PermissionsContextValue {
  permissions: CoopPermissions | null;
  hasPermission: (key: CoopPermissionKey) => boolean;
}

const PermissionsContext = createContext<PermissionsContextValue>({
  permissions: null,
  hasPermission: () => false,
});

export function PermissionsProvider({ children }: { children: React.ReactNode }) {
  const { selectedCoop } = useAdmin();

  const permissions = useMemo(() => {
    if (typeof window === 'undefined') return null;
    try {
      const token = localStorage.getItem('accessToken');
      if (!token) return null;
      const payload = JSON.parse(atob(token.split('.')[1]));

      // System admins get all permissions
      if (payload.role === 'SYSTEM_ADMIN') {
        return {
          canManageShareholders: true,
          canManageTransactions: true,
          canManageShareClasses: true,
          canManageProjects: true,
          canManageDividends: true,
          canManageSettings: true,
          canManageAdmins: true,
          canViewPII: true,
          canViewReports: true,
          canViewShareholderRegister: true,
        } as CoopPermissions;
      }

      const coopId = selectedCoop?.id;
      if (!coopId || !payload.coopPermissions) return null;
      return (payload.coopPermissions[coopId] as CoopPermissions) ?? null;
    } catch {
      return null;
    }
  }, [selectedCoop?.id]);

  const hasPermission = useCallback(
    (key: CoopPermissionKey) => {
      return permissions?.[key] === true;
    },
    [permissions],
  );

  return (
    <PermissionsContext.Provider value={{ permissions, hasPermission }}>
      {children}
    </PermissionsContext.Provider>
  );
}

export const usePermissions = () => useContext(PermissionsContext);
