'use client';

import { useParams } from 'next/navigation';
import { CoopRegisterContent } from '@/components/coop-register-content';

export default function ChannelRegisterPage() {
  const params = useParams<{ locale: string; coopSlug: string; channelSlug: string }>();

  return (
    <CoopRegisterContent coopSlug={params.coopSlug} channelSlug={params.channelSlug} />
  );
}
