'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';

interface AdminCoop {
  id: string;
  name: string;
  slug: string;
  active?: boolean;
}

interface AdminContextValue {
  selectedCoop: AdminCoop | null;
  setSelectedCoop: (coop: AdminCoop) => void;
  adminCoops: AdminCoop[];
  setAdminCoops: (coops: AdminCoop[]) => void;
}

const AdminContext = createContext<AdminContextValue>({
  selectedCoop: null,
  setSelectedCoop: () => {},
  adminCoops: [],
  setAdminCoops: () => {},
});

export function AdminProvider({ children }: { children: React.ReactNode }) {
  const [selectedCoop, setSelectedCoopState] = useState<AdminCoop | null>(null);
  const [adminCoops, setAdminCoops] = useState<AdminCoop[]>([]);

  useEffect(() => {
    const savedId = localStorage.getItem('opencoop-selected-coop-id');
    if (savedId && adminCoops.length > 0) {
      const coop = adminCoops.find((c) => c.id === savedId);
      if (coop) {
        setSelectedCoopState(coop);
      }
    }
  }, [adminCoops]);

  const setSelectedCoop = (coop: AdminCoop) => {
    setSelectedCoopState(coop);
    localStorage.setItem('opencoop-selected-coop-id', coop.id);
  };

  return (
    <AdminContext.Provider
      value={{ selectedCoop, setSelectedCoop, adminCoops, setAdminCoops }}
    >
      {children}
    </AdminContext.Provider>
  );
}

export function useAdmin() {
  return useContext(AdminContext);
}
