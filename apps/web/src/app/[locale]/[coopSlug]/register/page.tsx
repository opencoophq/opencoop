'use client';

import { useParams } from 'next/navigation';
import { CoopRegisterContent } from '@/components/coop-register-content';

export default function RegisterSharesPage() {
  const params = useParams<{ locale: string; coopSlug: string }>();
  const coopSlug = params.coopSlug;

  return <CoopRegisterContent coopSlug={coopSlug} />;
}
