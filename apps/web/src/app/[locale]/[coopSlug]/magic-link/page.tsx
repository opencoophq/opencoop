'use client';

import { useParams } from 'next/navigation';
import { CoopMagicLinkContent } from '@/components/auth/coop-magic-link-content';

export default function CoopMagicLinkPage() {
  const params = useParams();
  const coopSlug = params.coopSlug as string;

  return <CoopMagicLinkContent coopSlug={coopSlug} />;
}
