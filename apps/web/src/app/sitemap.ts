import type { MetadataRoute } from 'next';

const BASE_URL = 'https://opencoop.be';
const LOCALES = ['nl', 'en', 'fr', 'de'] as const;

const STATIC_PAGES = [
  { path: '', changeFrequency: 'weekly' as const, priority: 1.0 },
  { path: '/pricing', changeFrequency: 'weekly' as const, priority: 0.9 },
  { path: '/demo', changeFrequency: 'monthly' as const, priority: 0.8 },
  { path: '/migration', changeFrequency: 'monthly' as const, priority: 0.7 },
  { path: '/feature-request', changeFrequency: 'monthly' as const, priority: 0.5 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const entries: MetadataRoute.Sitemap = [];

  for (const page of STATIC_PAGES) {
    const languages: Record<string, string> = {};
    for (const locale of LOCALES) {
      languages[locale] = `${BASE_URL}/${locale}${page.path}`;
    }

    entries.push({
      url: `${BASE_URL}/nl${page.path}`,
      lastModified: new Date(),
      changeFrequency: page.changeFrequency,
      priority: page.priority,
      alternates: {
        languages,
      },
    });
  }

  return entries;
}
