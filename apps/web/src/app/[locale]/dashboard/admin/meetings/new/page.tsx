'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, useRouter } from '@/i18n/routing';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAdmin } from '@/contexts/admin-context';
import { ArrowLeft } from 'lucide-react';
import type { MeetingDto } from '@opencoop/shared';

const REMINDER_OPTIONS = [14, 7, 3, 1] as const;

const createMeetingSchema = z.object({
  type: z.enum(['ANNUAL', 'EXTRAORDINARY', 'WRITTEN']),
  title: z.string().min(1, 'Title is required'),
  scheduledAt: z.string().min(1, 'Date is required'),
  durationMinutes: z.coerce.number().int().min(1).max(24 * 60),
  location: z.string().optional(),
  format: z.enum(['PHYSICAL', 'HYBRID', 'DIGITAL']),
  votingWeight: z.enum(['PER_SHAREHOLDER', 'PER_SHARE']),
  maxProxiesPerPerson: z.coerce.number().int().min(0).max(50),
  reminderDaysBefore: z.array(z.number()).default([3]),
});

type CreateMeetingForm = z.infer<typeof createMeetingSchema>;

export default function NewMeetingPage() {
  const t = useTranslations();
  const router = useRouter();
  const { selectedCoop } = useAdmin();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useForm<CreateMeetingForm>({
    resolver: zodResolver(createMeetingSchema),
    defaultValues: {
      type: 'ANNUAL',
      title: '',
      scheduledAt: '',
      durationMinutes: 120,
      location: '',
      format: 'PHYSICAL',
      votingWeight: 'PER_SHAREHOLDER',
      maxProxiesPerPerson: 1,
      reminderDaysBefore: [3],
    },
  });

  const onSubmit = async (values: CreateMeetingForm) => {
    if (!selectedCoop) return;
    setSubmitting(true);
    setError(null);
    try {
      // datetime-local returns "YYYY-MM-DDTHH:mm" — convert to ISO
      const scheduledAtIso = new Date(values.scheduledAt).toISOString();
      const meeting = await api<MeetingDto>(
        `/admin/coops/${selectedCoop.id}/meetings`,
        {
          method: 'POST',
          body: {
            type: values.type,
            title: values.title,
            scheduledAt: scheduledAtIso,
            durationMinutes: values.durationMinutes,
            location: values.location || undefined,
            format: values.format,
            votingWeight: values.votingWeight,
            maxProxiesPerPerson: values.maxProxiesPerPerson,
            reminderDaysBefore: values.reminderDaysBefore,
          },
        },
      );
      router.push(`/dashboard/admin/meetings/${meeting.id}`);
    } catch {
      setError(t('meetings.new.errorCreating'));
      setSubmitting(false);
    }
  };

  if (!selectedCoop) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">{t('admin.selectCoop')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/dashboard/admin/meetings">
            <ArrowLeft className="h-4 w-4 mr-2" />
            {t('meetings.new.back')}
          </Link>
        </Button>
      </div>

      <div>
        <h1 className="text-2xl font-bold">{t('meetings.new.heading')}</h1>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('meetings.new.heading')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
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

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t('meetings.new.dateLabel')}</Label>
                <Input type="datetime-local" {...form.register('scheduledAt')} />
                {form.formState.errors.scheduledAt && (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.scheduledAt.message}
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
              <p className="text-xs text-muted-foreground">{t('meetings.new.reminderHint')}</p>
              <Controller
                control={form.control}
                name="reminderDaysBefore"
                render={({ field }) => {
                  const selected = new Set(field.value || []);
                  return (
                    <div className="flex flex-wrap gap-4 pt-1">
                      {REMINDER_OPTIONS.map((days) => {
                        const id = `reminder-${days}`;
                        return (
                          <label
                            key={days}
                            htmlFor={id}
                            className="flex items-center gap-2 text-sm cursor-pointer"
                          >
                            <Checkbox
                              id={id}
                              checked={selected.has(days)}
                              onCheckedChange={(checked) => {
                                const next = new Set(selected);
                                if (checked) next.add(days);
                                else next.delete(days);
                                field.onChange(Array.from(next).sort((a, b) => b - a));
                              }}
                            />
                            <span>{days}</span>
                          </label>
                        );
                      })}
                    </div>
                  );
                }}
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" asChild>
                <Link href="/dashboard/admin/meetings">{t('meetings.new.cancel')}</Link>
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? t('meetings.new.creating') : t('meetings.new.create')}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
