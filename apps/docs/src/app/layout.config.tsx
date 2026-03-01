import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { Building2 } from 'lucide-react';

export const baseOptions: BaseLayoutProps = {
  nav: {
    title: (
      <span className="flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-fd-primary text-fd-primary-foreground">
          <Building2 className="h-4 w-4" />
        </span>
        <span className="font-semibold">OpenCoop Docs</span>
      </span>
    ),
    url: '/',
  },
  i18n: true,
  links: [
    {
      text: 'OpenCoop',
      url: 'https://opencoop.be',
    },
  ],
};
