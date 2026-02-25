'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Copy, Check } from 'lucide-react';
import { copyTableAsHtml, isClipboardWriteSupported } from '@/lib/chart-export';

interface CopyTableButtonProps {
  tableRef: React.RefObject<HTMLTableElement | null>;
}

export function CopyTableButton({ tableRef }: CopyTableButtonProps) {
  const t = useTranslations('reports');
  const [copied, setCopied] = useState(false);

  if (!isClipboardWriteSupported()) return null;

  const handleCopy = async () => {
    if (!tableRef.current) return;
    try {
      await copyTableAsHtml(tableRef.current);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Silent failure
    }
  };

  return (
    <Button variant="outline" size="sm" onClick={handleCopy}>
      {copied ? <Check className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />}
      {copied ? t('copied') : t('copyTable')}
    </Button>
  );
}
