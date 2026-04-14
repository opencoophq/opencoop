'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// DD/MM/YYYY
const DATE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
// HH:MM (24h)
const TIME_RE = /^(\d{1,2}):(\d{2})$/;

function parseDateTime(dateStr: string, timeStr: string): Date | null {
  const dMatch = dateStr.trim().match(DATE_RE);
  const tMatch = timeStr.trim().match(TIME_RE);
  if (!dMatch || !tMatch) return null;
  const [, dd, mm, yyyy] = dMatch;
  const [, hh, min] = tMatch;
  const day = Number(dd),
    month = Number(mm),
    year = Number(yyyy),
    hour = Number(hh),
    minute = Number(min);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59) return null;
  const dt = new Date(year, month - 1, day, hour, minute, 0);
  if (Number.isNaN(dt.getTime())) return null;
  // Round-trip sanity: reject e.g. 31/02/2026 which overflows into March
  if (dt.getFullYear() !== year || dt.getMonth() !== month - 1 || dt.getDate() !== day) {
    return null;
  }
  return dt;
}

function formatDateParts(iso: string | undefined): { dateStr: string; timeStr: string } {
  if (!iso) return { dateStr: '', timeStr: '' };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { dateStr: '', timeStr: '' };
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    dateStr: `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`,
    timeStr: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

function parseReminderDays(input: string): number[] {
  const parts = input
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const nums = parts
    .map((p) => Number(p))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 365);
  return [...new Set(nums)].sort((a, b) => b - a);
}

const meetingFormSchema = z.object({
  type: z.enum(['ANNUAL', 'EXTRAORDINARY', 'WRITTEN']),
  title: z.string().min(1, 'Title is required'),
  dateStr: z.string().regex(DATE_RE, 'Datum moet DD/MM/JJJJ zijn'),
  timeStr: z.string().regex(TIME_RE, 'Tijd moet HH:MM zijn'),
  durationMinutes: z.coerce.number().int().min(1).max(24 * 60),
  location: z.string().optional(),
  format: z.enum(['PHYSICAL', 'HYBRID', 'DIGITAL']),
  votingWeight: z.enum(['PER_SHAREHOLDER', 'PER_SHARE']),
  maxProxiesPerPerson: z.coerce.number().int().min(0).max(50),
  reminderDaysInput: z.string(),
});

export type MeetingFormValues = z.infer<typeof meetingFormSchema>;

export interface MeetingSubmitPayload {
  type: 'ANNUAL' | 'EXTRAORDINARY' | 'WRITTEN';
  title: string;
  scheduledAt: string; // ISO
  durationMinutes: number;
  location?: string;
  format: 'PHYSICAL' | 'HYBRID' | 'DIGITAL';
  votingWeight: 'PER_SHAREHOLDER' | 'PER_SHARE';
  maxProxiesPerPerson: number;
  reminderDaysBefore: number[];
}

export interface MeetingFormInitialValues {
  type?: 'ANNUAL' | 'EXTRAORDINARY' | 'WRITTEN';
  title?: string;
  scheduledAt?: string; // ISO
  durationMinutes?: number;
  location?: string | null;
  format?: 'PHYSICAL' | 'HYBRID' | 'DIGITAL';
  votingWeight?: 'PER_SHAREHOLDER' | 'PER_SHARE';
  maxProxiesPerPerson?: number;
  reminderDaysBefore?: number[];
}

interface MeetingFormProps {
  initialValues?: MeetingFormInitialValues;
  heading: string;
  submitLabel: string;
  submittingLabel: string;
  cancelHref: string;
  onSubmit: (payload: MeetingSubmitPayload) => Promise<void>;
}

export function MeetingForm({
  initialValues,
  heading,
  submitLabel,
  submittingLabel,
  cancelHref,
  onSubmit,
}: MeetingFormProps) {
  const t = useTranslations();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { dateStr, timeStr } = formatDateParts(initialValues?.scheduledAt);

  const form = useForm<MeetingFormValues>({
    resolver: zodResolver(meetingFormSchema),
    defaultValues: {
      type: initialValues?.type ?? 'ANNUAL',
      title: initialValues?.title ?? '',
      dateStr,
      timeStr,
      durationMinutes: initialValues?.durationMinutes ?? 120,
      location: initialValues?.location ?? '',
      format: initialValues?.format ?? 'PHYSICAL',
      votingWeight: initialValues?.votingWeight ?? 'PER_SHAREHOLDER',
      maxProxiesPerPerson: initialValues?.maxProxiesPerPerson ?? 1,
      reminderDaysInput: (initialValues?.reminderDaysBefore ?? [3]).join(', '),
    },
  });

  const handle = async (values: MeetingFormValues) => {
    setError(null);
    const dt = parseDateTime(values.dateStr, values.timeStr);
    if (!dt) {
      setError(t('meetings.new.invalidDateTime'));
      return;
    }
    const reminderDaysBefore = parseReminderDays(values.reminderDaysInput);
    if (reminderDaysBefore.length === 0) {
      setError(t('meetings.new.invalidReminderDays'));
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({
        type: values.type,
        title: values.title,
        scheduledAt: dt.toISOString(),
        durationMinutes: values.durationMinutes,
        location: values.location || undefined,
        format: values.format,
        votingWeight: values.votingWeight,
        maxProxiesPerPerson: values.maxProxiesPerPerson,
        reminderDaysBefore,
      });
    } catch {
      setError(t('meetings.new.errorSaving'));
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{heading}</CardTitle>
      </CardHeader>
      <CardContent>
        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <form onSubmit={form.handleSubmit(handle)} className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{t('meetings.new.typeLabel')}</Label>
              <Controller
                control={form.control}
                name="type"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ANNUAL">{t('meetings.type.annual')}</SelectItem>
                      <SelectItem value="EXTRAORDINARY">
                        {t('meetings.type.extraordinary')}
                      </SelectItem>
                      <SelectItem value="WRITTEN">{t('meetings.type.written')}</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div className="space-y-2">
              <Label>{t('meetings.new.formatLabel')}</Label>
              <Controller
                control={form.control}
                name="format"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PHYSICAL">{t('meetings.format.physical')}</SelectItem>
                      <SelectItem value="HYBRID">{t('meetings.format.hybrid')}</SelectItem>
                      <SelectItem value="DIGITAL">{t('meetings.format.digital')}</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>{t('meetings.new.titleLabel')}</Label>
            <Input
              {...form.register('title')}
              placeholder={t('meetings.new.titlePlaceholder')}
            />
            {form.formState.errors.title && (
              <p className="text-sm text-destructive">
                {form.formState.errors.title.message}
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>{t('meetings.new.dateInputLabel')}</Label>
              <Input {...form.register('dateStr')} placeholder="09/05/2026" />
              {form.formState.errors.dateStr && (
                <p className="text-sm text-destructive">
                  {form.formState.errors.dateStr.message}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label>{t('meetings.new.timeInputLabel')}</Label>
              <Input {...form.register('timeStr')} placeholder="10:00" />
              {form.formState.errors.timeStr && (
                <p className="text-sm text-destructive">
                  {form.formState.errors.timeStr.message}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label>{t('meetings.new.durationLabel')}</Label>
              <Input
                type="number"
                min={15}
                step={15}
                {...form.register('durationMinutes')}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>{t('meetings.new.locationLabel')}</Label>
            <Input
              {...form.register('location')}
              placeholder={t('meetings.new.locationPlaceholder')}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{t('meetings.new.votingWeightLabel')}</Label>
              <Controller
                control={form.control}
                name="votingWeight"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PER_SHAREHOLDER">
                        {t('meetings.votingWeight.perShareholder')}
                      </SelectItem>
                      <SelectItem value="PER_SHARE">
                        {t('meetings.votingWeight.perShare')}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('meetings.new.maxProxiesLabel')}</Label>
              <Input
                type="number"
                min={0}
                max={50}
                {...form.register('maxProxiesPerPerson')}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>{t('meetings.new.reminderLabel')}</Label>
            <Input {...form.register('reminderDaysInput')} placeholder="7, 3, 1" />
            <p className="text-xs text-muted-foreground">{t('meetings.new.reminderHint')}</p>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" asChild>
              <a href={cancelHref}>{t('meetings.new.cancel')}</a>
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? submittingLabel : submitLabel}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
