'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAdmin } from '@/contexts/admin-context';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { selectedCoop, adminCoops } = useAdmin();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const userData = localStorage.getItem('user');
    if (!userData) {
      router.push('/login');
      return;
    }

    try {
      const user = JSON.parse(userData);
      if (user.role !== 'COOP_ADMIN' && user.role !== 'SYSTEM_ADMIN') {
        router.push('/dashboard');
        return;
      }
    } catch {
      router.push('/login');
      return;
    }

    setChecked(true);
  }, [router]);

  if (!checked) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!selectedCoop && adminCoops.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">No cooperatives assigned. Contact a system administrator.</p>
      </div>
    );
  }

  return <>{children}</>;
}
