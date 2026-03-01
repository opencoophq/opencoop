'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { EmailFirstLogin } from '@/components/auth/email-first-login';

export default function LoginPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (localStorage.getItem('accessToken')) {
      router.replace('/dashboard');
    } else {
      setReady(true);
    }
  }, [router]);

  if (!ready) return null;

  return <EmailFirstLogin />;
}
