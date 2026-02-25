'use client';

import { useParams } from 'next/navigation';
import { CoopLoginContent } from '@/components/auth/coop-login-content';

export default function CoopLoginPage() {
  const params = useParams();
  const coopSlug = params.coopSlug as string;

  return <CoopLoginContent coopSlug={coopSlug} />;
}
