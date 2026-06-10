'use client';

import { useTranslations } from 'next-intl';

/**
 * Reusable inline error state for failed data fetches. Renders a destructive
 * panel with an optional "Try again" action so an API outage is visually
 * distinct from a genuinely-empty result.
 */
export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  const t = useTranslations();
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center dark:border-red-900/40 dark:bg-red-950/30">
      <p className="text-sm text-red-700 dark:text-red-300">{message || t('common.loadError')}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-3 text-sm font-medium text-red-700 underline dark:text-red-300"
        >
          {t('common.retry')}
        </button>
      )}
    </div>
  );
}
