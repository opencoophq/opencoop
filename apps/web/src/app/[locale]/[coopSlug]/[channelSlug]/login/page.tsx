'use client';

import { useParams } from 'next/navigation';
import { CoopLoginContent } from '@/components/auth/coop-login-content';

export default function ChannelLoginPage() {
  const params = useParams<{ locale: string; coopSlug: string; channelSlug: string }>();

  return (
    <CoopLoginContent coopSlug={params.coopSlug} channelSlug={params.channelSlug} />
  );
}
