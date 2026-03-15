'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';
import { Badge } from '@/components/ui/badge';

interface ChangelogSection {
  type: string;
  items: string[];
}

interface ChangelogEntry {
  version: string;
  date: string;
  sections: ChangelogSection[];
}

const sectionColors: Record<string, string> = {
  Added: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  Fixed: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
  Changed: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  Removed: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  Security: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
  Deprecated: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300',
};

function formatItem(raw: string): React.ReactNode {
  // Bold text between ** **
  const parts = raw.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

export default function ChangelogPage() {
  const t = useTranslations('changelog');
  const [entries, setEntries] = useState<ChangelogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<ChangelogEntry[]>('/changelog')
      .then(setEntries)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="text-muted-foreground mt-1">{t('description')}</p>
      </div>

      <div className="space-y-8">
        {entries.map((entry, i) => (
          <div key={entry.version} className="relative">
            {/* Timeline line */}
            {i < entries.length - 1 && (
              <div className="absolute left-[11px] top-8 bottom-[-2rem] w-px bg-border" />
            )}

            <div className="flex items-start gap-4">
              {/* Dot */}
              <div className="mt-1 flex-shrink-0 w-6 h-6 rounded-full border-2 border-primary bg-background flex items-center justify-center">
                <div className="w-2 h-2 rounded-full bg-primary" />
              </div>

              <div className="flex-1 pb-2">
                <div className="flex items-center gap-3 mb-3">
                  <span className="font-semibold text-lg">v{entry.version}</span>
                  <span className="text-sm text-muted-foreground">{entry.date}</span>
                </div>

                <div className="space-y-4">
                  {entry.sections.map((section) => (
                    <div key={section.type}>
                      <Badge
                        variant="secondary"
                        className={`mb-2 ${sectionColors[section.type] ?? ''}`}
                      >
                        {section.type}
                      </Badge>
                      <ul className="space-y-1">
                        {section.items.map((item, j) => (
                          <li key={j} className="text-sm text-foreground/80 flex gap-2">
                            <span className="text-muted-foreground mt-0.5">•</span>
                            <span>{formatItem(item)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ))}

        {entries.length === 0 && (
          <p className="text-muted-foreground text-sm">{t('empty')}</p>
        )}
      </div>
    </div>
  );
}
