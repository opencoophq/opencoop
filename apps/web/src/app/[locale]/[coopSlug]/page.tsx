import { redirect } from 'next/navigation';
import { toQueryString } from '@/lib/query-string';

export default async function CoopPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; coopSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, coopSlug } = await params;
  redirect(`/${locale}/${coopSlug}/login${toQueryString(await searchParams)}`);
}
