'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { CheckCircle, XCircle, Loader2, Shield } from 'lucide-react';

interface InvitationInfo {
  coopName: string;
  roleName: string;
  email: string;
}

export default function InviteAcceptPage() {
  const params = useParams();
  const router = useRouter();
  const t = useTranslations('admin.team');
  const token = params.token as string;

  const [status, setStatus] = useState<'loading' | 'preview' | 'accepting' | 'success' | 'error'>('loading');
  const [invitation, setInvitation] = useState<InvitationInfo | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    const loadInvitation = async () => {
      try {
        const data = await api<InvitationInfo>(`/auth/invitation/${token}`);
        setInvitation(data);
        setStatus('preview');
      } catch (err: any) {
        setErrorMessage(err.message || 'Invalid or expired invitation');
        setStatus('error');
      }
    };
    loadInvitation();
  }, [token]);

  const handleAccept = async () => {
    const accessToken = localStorage.getItem('accessToken');
    if (!accessToken) {
      // Not logged in - redirect to login with return URL
      router.push(`/login?redirect=/invite/${token}`);
      return;
    }

    setStatus('accepting');
    try {
      await api('/auth/accept-invitation', {
        method: 'POST',
        body: { token },
      });
      setStatus('success');
      // Refresh the JWT to include new coop permissions
      const meData = await api<{ accessToken?: string }>('/auth/refresh');
      if (meData?.accessToken) {
        localStorage.setItem('accessToken', meData.accessToken);
      }
      setTimeout(() => router.push('/dashboard/admin'), 2000);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to accept invitation');
      setStatus('error');
    }
  };

  return (
    <div className="min-h-screen bg-muted/50 flex items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="w-12 h-12 bg-primary/10 text-primary rounded-full flex items-center justify-center mx-auto mb-4">
            <Shield className="w-6 h-6" />
          </div>
          <CardTitle>{t('invitationTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="text-center space-y-4">
          {status === 'loading' && (
            <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
          )}

          {status === 'preview' && invitation && (
            <>
              <p className="text-muted-foreground">
                {t('invitationMessage', {
                  coop: invitation.coopName,
                  role: invitation.roleName,
                })}
              </p>
              <Button onClick={handleAccept} className="w-full">
                {t('acceptInvitation')}
              </Button>
            </>
          )}

          {status === 'accepting' && (
            <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
          )}

          {status === 'success' && (
            <>
              <CheckCircle className="h-12 w-12 text-green-500 mx-auto" />
              <p className="text-green-600 font-medium">{t('invitationAccepted')}</p>
            </>
          )}

          {status === 'error' && (
            <>
              <XCircle className="h-12 w-12 text-destructive mx-auto" />
              <p className="text-destructive">{errorMessage}</p>
              <Button variant="outline" onClick={() => router.push('/dashboard')}>
                {t('goToDashboard')}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
