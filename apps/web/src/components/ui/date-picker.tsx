'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';

interface DatePickerProps {
  value?: string; // ISO date string (YYYY-MM-DD)
  onChange?: (value: string | undefined) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  defaultMonth?: Date; // unused, kept for API compat
}

export function DatePicker({
  value,
  onChange,
  disabled = false,
  className,
}: DatePickerProps) {
  return (
    <Input
      type="date"
      value={value || ''}
      onChange={(e) => onChange?.(e.target.value || undefined)}
      disabled={disabled}
      className={cn('w-full', className)}
    />
  );
}
