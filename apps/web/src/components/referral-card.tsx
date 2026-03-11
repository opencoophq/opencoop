'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { UserPlus, Copy, Check, MessageCircle, Mail } from 'lucide-react';

interface ReferralStats {
  referralCode: string | null;
  referralLink: string | null;
  totalReferred: number;
  convertedReferred: number;
  referrals: Array<{
    firstName: string | null;
    lastInitial: string | null;
    status: string;
    registeredAt: string;
  }>;
}

export function ReferralCard({ shareholderId, coopName }: { shareholderId: string; coopName?: string }) {
  const t = useTranslations('referral');
  const [stats, setStats] = useState<ReferralStats | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api<ReferralStats>(`/shareholders/${shareholderId}/referral-stats`)
      .then(setStats)
      .catch(() => {});
  }, [shareholderId]);

  if (!stats?.referralCode) return null;

  const handleCopy = async () => {
    if (!stats.referralLink) return;
    await navigator.clipboard.writeText(stats.referralLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleWhatsApp = () => {
    if (!stats.referralLink) return;
    const message = t('whatsappMessage', { coopName: coopName || '', link: stats.referralLink });
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank');
  };

  const handleEmail = () => {
    if (!stats.referralLink) return;
    const subject = t('emailSubject', { coopName: coopName || '' });
    const body = t('emailBody', { coopName: coopName || '', link: stats.referralLink });
    window.open(`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`, '_blank');
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{t('inviteFriend')}</CardTitle>
        <UserPlus className="h-5 w-5 text-green-600" />
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{t('inviteFriendDescription')}</p>

        {/* Referral link with copy */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">{t('yourLink')}</label>
          <div className="flex gap-2">
            <Input
              readOnly
              value={stats.referralLink || ''}
              className="text-xs font-mono"
            />
            <Button variant="outline" size="icon" onClick={handleCopy} className="flex-shrink-0">
              {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        {/* Share buttons */}
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleWhatsApp} className="flex-1">
            <MessageCircle className="h-4 w-4 mr-1.5" />
            {t('shareWhatsapp')}
          </Button>
          <Button variant="outline" size="sm" onClick={handleEmail} className="flex-1">
            <Mail className="h-4 w-4 mr-1.5" />
            {t('shareEmail')}
          </Button>
        </div>

        {/* Stats */}
        {stats.totalReferred > 0 ? (
          <div className="pt-2 border-t space-y-1">
            <p className="text-sm font-medium">
              {t('youReferred', { count: stats.totalReferred })}
            </p>
            <p className="text-sm text-muted-foreground">
              {t('convertedCount', { count: stats.convertedReferred })}
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground pt-2 border-t">
            {t('noReferralsYet')}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
