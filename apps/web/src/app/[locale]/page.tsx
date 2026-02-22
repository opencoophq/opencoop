'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { Building2, LogIn } from 'lucide-react';

export default function HomePage() {
  const t = useTranslations();

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-4">
      <div className="text-center max-w-lg">
        <Building2 className="h-16 w-16 text-primary mx-auto mb-6" />
        <h1 className="text-4xl font-bold mb-2">{t('home.title')}</h1>
        <p className="text-lg text-muted-foreground mb-8">
          {t('home.subtitle')}
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link href="/login">
            <Button size="lg" className="w-full sm:w-auto">
              <LogIn className="h-4 w-4 mr-2" />
              {t('auth.login')}
            </Button>
          </Link>
          <Link href="/register">
            <Button size="lg" variant="outline" className="w-full sm:w-auto">
              {t('auth.register')}
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
