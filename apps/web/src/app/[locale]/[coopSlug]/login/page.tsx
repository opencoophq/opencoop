import { redirect } from 'next/navigation';
import { toQueryString } from '@/lib/query-string';

export default async function CoopLoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; coopSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, coopSlug } = await params;
  // Keep ?redirect=... on the way to the default channel's login page.
  redirect(`/${locale}/${coopSlug}/default/login${toQueryString(await searchParams)}`);
}
