'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSearchParams } from 'next/navigation';
import { EmailFirstLogin } from '@/components/auth/email-first-login';

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const addAccount = searchParams.get('addAccount') === 'true';
    if (!addAccount && localStorage.getItem('accessToken')) {
      router.replace('/dashboard');
    } else {
      setReady(true);
    }
  }, [router, searchParams]);

  if (!ready) return null;

  return <EmailFirstLogin />;
}
