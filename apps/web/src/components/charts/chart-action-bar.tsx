'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Copy, Download, MoreHorizontal, Check } from 'lucide-react';
import {
  copyImageToClipboard,
  chartToPngBlob,
  downloadChartPng,
  downloadChartSvg,
  isClipboardWriteSupported,
} from '@/lib/chart-export';

interface ChartActionBarProps {
  chartRef: React.RefObject<HTMLDivElement | null>;
  filename: string;
}

export function ChartActionBar({ chartRef, filename }: ChartActionBarProps) {
  const t = useTranslations('reports');
  const [copied, setCopied] = useState(false);

  const handleCopyImage = async () => {
    if (!chartRef.current) return;
    try {
      const blob = await chartToPngBlob(chartRef.current);
      await copyImageToClipboard(blob);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Silent failure
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {isClipboardWriteSupported() && (
          <DropdownMenuItem onClick={handleCopyImage}>
            {copied ? <Check className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
            {copied ? t('copied') : t('copyAsImage')}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => chartRef.current && downloadChartPng(chartRef.current, filename)}>
          <Download className="h-4 w-4 mr-2" />
          {t('downloadPng')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => chartRef.current && downloadChartSvg(chartRef.current, filename)}>
          <Download className="h-4 w-4 mr-2" />
          {t('downloadSvg')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
