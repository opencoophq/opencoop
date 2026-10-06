'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { EmailFirstLogin } from '@/components/auth/email-first-login';
import { rememberPostLoginRedirect } from '@/lib/post-login-redirect';

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // ?redirect=/nl/dashboard/... survives the login; the dashboard layout consumes it.
    rememberPostLoginRedirect(searchParams.get('redirect'));
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
