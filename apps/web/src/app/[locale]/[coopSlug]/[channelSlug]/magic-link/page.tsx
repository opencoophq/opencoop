'use client';

import { useParams } from 'next/navigation';
import { CoopMagicLinkContent } from '@/components/auth/coop-magic-link-content';

export default function ChannelMagicLinkPage() {
  const params = useParams<{ locale: string; coopSlug: string; channelSlug: string }>();

  return (
    <CoopMagicLinkContent
      coopSlug={params.coopSlug}
      channelSlug={params.channelSlug}
    />
  );
}
