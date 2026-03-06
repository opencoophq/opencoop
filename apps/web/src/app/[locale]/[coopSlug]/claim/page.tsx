import { redirect } from 'next/navigation';

export default async function ClaimGiftPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; coopSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, coopSlug } = await params;
  const query = await searchParams;
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === 'string') qs.set(key, value);
  }
  const search = qs.toString();
  redirect(`/${locale}/${coopSlug}/default/claim${search ? `?${search}` : ''}`);
}
