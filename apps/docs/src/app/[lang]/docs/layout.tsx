import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import type { ReactNode } from 'react';
import { baseOptions } from '@/app/layout.config';
import { source } from '@/lib/source';

export default function Layout({
  params,
  children,
}: {
  params: { lang: string };
  children: ReactNode;
}) {
  return (
    <DocsLayout
      tree={source.pageTree[params.lang]}
      {...baseOptions}
    >
      {children}
    </DocsLayout>
  );
}
