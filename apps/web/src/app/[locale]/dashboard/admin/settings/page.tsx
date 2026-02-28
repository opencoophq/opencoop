'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useTranslations, useLocale as useIntlLocale } from 'next-intl';
import { useAdmin } from '@/contexts/admin-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api, resolveLogoUrl } from '@/lib/api';
import {
  Info,
  AlertTriangle,
  Upload,
  Trash2,
  ImageIcon,
  Link2,
  Copy,
  Check,
} from 'lucide-react';
import ReactCrop, {
  type Crop,
  type PixelCrop,
  centerCrop,
  makeAspectCrop,
} from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';

type EmailProvider = 'platform' | 'smtp' | 'graph';

interface FormState {
  name: string;
  requiresApproval: boolean;
  minimumHoldingPeriod: string;
  bankName: string;
  bankIban: string;
  bankBic: string;
  termsUrl: string;
  emailEnabled: boolean;
  emailProvider: EmailProvider;
  smtpHost: string;
  smtpPort: string;
  smtpUser: string;
  smtpPass: string;
  smtpFrom: string;
  graphClientId: string;
  graphClientSecret: string;
  graphTenantId: string;
  graphFromEmail: string;
}

interface SettingsResponse {
  name: string;
  requiresApproval: boolean;
  minimumHoldingPeriod: number;
  bankName: string | null;
  bankIban: string | null;
  bankBic: string | null;
  termsUrl: string | null;
  emailEnabled: boolean;
  emailProvider: string | null;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpUser: string | null;
  smtpFrom: string | null;
  graphClientId: string | null;
  graphTenantId: string | null;
  graphFromEmail: string | null;
}

interface BrandingFormState {
  primaryColor: string;
  secondaryColor: string;
}

interface CoopPublicInfo {
  logoUrl?: string;
  primaryColor?: string;
  secondaryColor?: string;
  name?: string;
}

function toEmailProvider(value: string | null): EmailProvider {
  if (value === 'smtp') return 'smtp';
  if (value === 'graph') return 'graph';
  return 'platform';
}

function getCroppedBlob(image: HTMLImageElement, crop: PixelCrop): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  const scaleX = image.naturalWidth / image.width;
  const scaleY = image.naturalHeight / image.height;
  canvas.width = crop.width * scaleX;
  canvas.height = crop.height * scaleY;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.resolve(null);

  ctx.drawImage(
    image,
    crop.x * scaleX,
    crop.y * scaleY,
    crop.width * scaleX,
    crop.height * scaleY,
    0,
    0,
    canvas.width,
    canvas.height,
  );

  return new Promise((resolve) => {
    canvas.toBlob(resolve, 'image/png', 1);
  });
}

function onImageLoad(
  e: React.SyntheticEvent<HTMLImageElement>,
  setCrop: (crop: Crop) => void,
) {
  const { width, height } = e.currentTarget;
  const crop = centerCrop(
    makeAspectCrop({ unit: '%', width: 90 }, 1, width, height),
    width,
    height,
  );
  setCrop(crop);
}

export default function AdminSettingsPage() {
  const t = useTranslations();
  const { selectedCoop } = useAdmin();
  const intlLocale = useIntlLocale();

  // Settings form state
  const [form, setForm] = useState<FormState>({
    name: '',
    requiresApproval: true,
    minimumHoldingPeriod: '0',
    bankName: '',
    bankIban: '',
    bankBic: '',
    termsUrl: '',
    emailEnabled: true,
    emailProvider: 'platform',
    smtpHost: '',
    smtpPort: '',
    smtpUser: '',
    smtpPass: '',
    smtpFrom: '',
    graphClientId: '',
    graphClientSecret: '',
    graphTenantId: '',
    graphFromEmail: '',
  });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [isSystemAdmin, setIsSystemAdmin] = useState(false);

  // Branding state
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [brandingForm, setBrandingForm] = useState<BrandingFormState>({
    primaryColor: '#1e40af',
    secondaryColor: '#3b82f6',
  });
  const [uploading, setUploading] = useState(false);
  const [cropDialogOpen, setCropDialogOpen] = useState(false);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState<Crop>();
  const [completedCrop, setCompletedCrop] = useState<PixelCrop>();
  const imgRef = useRef<HTMLImageElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Shareholder links state
  const [copiedLink, setCopiedLink] = useState<string | null>(null);

  useEffect(() => {
    const userData = localStorage.getItem('user');
    if (userData) {
      try {
        const parsed = JSON.parse(userData);
        setIsSystemAdmin(parsed.role === 'SYSTEM_ADMIN');
      } catch {
        // ignore
      }
    }
  }, []);

  useEffect(() => {
    if (!selectedCoop) return;
    setLoading(true);

    Promise.all([
      api<SettingsResponse>(`/admin/coops/${selectedCoop.id}/settings`),
      api<CoopPublicInfo>(`/coops/${selectedCoop.slug}/public-info`),
    ])
      .then(([settings, publicInfo]) => {
        setForm({
          name: settings.name || '',
          requiresApproval: settings.requiresApproval,
          minimumHoldingPeriod: (settings.minimumHoldingPeriod || 0).toString(),
          bankName: settings.bankName || '',
          bankIban: settings.bankIban || '',
          bankBic: settings.bankBic || '',
          termsUrl: settings.termsUrl || '',
          emailEnabled: settings.emailEnabled,
          emailProvider: toEmailProvider(settings.emailProvider),
          smtpHost: settings.smtpHost || '',
          smtpPort: settings.smtpPort?.toString() || '',
          smtpUser: settings.smtpUser || '',
          smtpPass: '',
          smtpFrom: settings.smtpFrom || '',
          graphClientId: settings.graphClientId || '',
          graphClientSecret: '',
          graphTenantId: settings.graphTenantId || '',
          graphFromEmail: settings.graphFromEmail || '',
        });
        setLogoUrl(publicInfo.logoUrl || null);
        setBrandingForm({
          primaryColor: publicInfo.primaryColor || '#1e40af',
          secondaryColor: publicInfo.secondaryColor || '#3b82f6',
        });
      })
      .catch(() => {
        setError(t('admin.settings.error'));
      })
      .finally(() => setLoading(false));
  }, [selectedCoop, t]);

  const showMessage = (msg: string) => {
    setMessage(msg);
    setTimeout(() => setMessage(''), 3000);
  };

  const handleSave = async () => {
    if (!selectedCoop) return;
    setError('');
    try {
      const body: Record<string, unknown> = {
        name: form.name,
        requiresApproval: form.requiresApproval,
        minimumHoldingPeriod: parseInt(form.minimumHoldingPeriod, 10) || 0,
        bankName: form.bankName,
        bankIban: form.bankIban,
        bankBic: form.bankBic,
        termsUrl: form.termsUrl,
        emailProvider: form.emailProvider === 'platform' ? null : form.emailProvider,
      };

      if (isSystemAdmin) {
        body.emailEnabled = form.emailEnabled;
      }

      if (form.emailProvider === 'smtp') {
        body.smtpHost = form.smtpHost;
        body.smtpPort = form.smtpPort ? parseInt(form.smtpPort, 10) : undefined;
        body.smtpUser = form.smtpUser;
        body.smtpFrom = form.smtpFrom;
        if (form.smtpPass) body.smtpPass = form.smtpPass;
      }

      if (form.emailProvider === 'graph') {
        body.graphClientId = form.graphClientId;
        body.graphTenantId = form.graphTenantId;
        body.graphFromEmail = form.graphFromEmail;
        if (form.graphClientSecret) body.graphClientSecret = form.graphClientSecret;
      }

      await api(`/admin/coops/${selectedCoop.id}/settings`, { method: 'PUT', body });
      showMessage(t('admin.settings.saved'));
    } catch {
      setError(t('admin.settings.error'));
    }
  };

  const handleBrandingSave = async () => {
    if (!selectedCoop) return;
    try {
      await api(`/admin/coops/${selectedCoop.id}/branding`, {
        method: 'PUT',
        body: brandingForm,
      });
      showMessage(t('common.savedSuccessfully'));
    } catch {
      // ignore
    }
  };

  const handleFileSelect = useCallback(
    (file: File) => {
      const allowedTypes = [
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/gif',
        'image/svg+xml',
      ];
      if (!allowedTypes.includes(file.type)) {
        setMessage(t('admin.branding.invalidFileType'));
        setTimeout(() => setMessage(''), 5000);
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        setMessage(t('admin.branding.fileTooLarge'));
        setTimeout(() => setMessage(''), 5000);
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        setImageSrc(reader.result as string);
        setCropDialogOpen(true);
      };
      reader.readAsDataURL(file);
    },
    [t],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) handleFileSelect(file);
    },
    [handleFileSelect],
  );

  const handleUploadCropped = async () => {
    if (!selectedCoop || !imgRef.current || !completedCrop) return;

    setUploading(true);
    try {
      const blob = await getCroppedBlob(imgRef.current, completedCrop);
      if (!blob) throw new Error('Failed to crop image');

      const formData = new FormData();
      formData.append('file', blob, 'logo.png');

      const result = await api<{ logoUrl: string }>(
        `/admin/coops/${selectedCoop.id}/logo`,
        { method: 'POST', body: formData },
      );

      setLogoUrl(result.logoUrl);
      setCropDialogOpen(false);
      setImageSrc(null);
      showMessage(t('common.savedSuccessfully'));
    } catch {
      setMessage(t('admin.branding.uploadError'));
      setTimeout(() => setMessage(''), 5000);
    } finally {
      setUploading(false);
    }
  };

  const handleRemoveLogo = async () => {
    if (!selectedCoop) return;
    try {
      await api(`/admin/coops/${selectedCoop.id}/logo`, { method: 'DELETE' });
      setLogoUrl(null);
      showMessage(t('common.savedSuccessfully'));
    } catch {
      // ignore
    }
  };

  const handleCopyLink = async (key: string, url: string) => {
    await navigator.clipboard.writeText(url);
    setCopiedLink(key);
    setTimeout(() => setCopiedLink(null), 2000);
  };

  if (!selectedCoop) return <p className="text-muted-foreground">{t('admin.selectCoop')}</p>;

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  const emailDisabled = !form.emailEnabled;
  const resolvedLogoUrl = resolveLogoUrl(logoUrl);

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const coopBasePath = `${baseUrl}/${intlLocale}/${selectedCoop.slug}`;
  const shareholderLinks = [
    { key: 'publicPage', url: coopBasePath },
    { key: 'registrationLink', url: `${coopBasePath}/register` },
    { key: 'loginLink', url: `${coopBasePath}/login` },
  ];

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold mb-6">{t('common.settings')}</h1>
      {message && (
        <Alert className="mb-4">
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-6">
        {/* Shareholder Links */}
        <Card>
          <CardHeader className="flex flex-row items-center space-y-0">
            <Link2 className="h-5 w-5 text-muted-foreground mr-2" />
            <CardTitle>{t('admin.shareholderLinks')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {shareholderLinks.map(({ key, url }) => (
              <div
                key={key}
                className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">{t(`admin.${key}`)}</p>
                  <p className="text-xs text-muted-foreground truncate">{url}</p>
                </div>
                <button
                  onClick={() => handleCopyLink(key, url)}
                  className="shrink-0 rounded-md p-1.5 hover:bg-muted transition-colors"
                  title={copiedLink === key ? t('admin.copied') : 'Copy'}
                >
                  {copiedLink === key ? (
                    <Check className="h-4 w-4 text-green-600" />
                  ) : (
                    <Copy className="h-4 w-4 text-muted-foreground" />
                  )}
                </button>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* General Settings */}
        <Card>
          <CardHeader>
            <CardTitle>{t('admin.settings.general')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>{t('common.name')}</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                checked={form.requiresApproval}
                onCheckedChange={(c) => setForm({ ...form, requiresApproval: !!c })}
              />
              <Label>{t('admin.settings.requiresApproval')}</Label>
            </div>
            <div>
              <Label>{t('admin.settings.termsUrl')}</Label>
              <Input
                value={form.termsUrl}
                onChange={(e) => setForm({ ...form, termsUrl: e.target.value })}
                placeholder="https://..."
              />
            </div>
            <div>
              <Label>{t('admin.settings.minHoldingPeriod')}</Label>
              <Input
                type="number"
                min={0}
                value={form.minimumHoldingPeriod}
                onChange={(e) => setForm({ ...form, minimumHoldingPeriod: e.target.value })}
              />
            </div>
          </CardContent>
        </Card>

        {/* Bank Details */}
        <Card>
          <CardHeader>
            <CardTitle>{t('admin.settings.bankDetails')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>{t('admin.settings.bankName')}</Label>
              <Input
                value={form.bankName}
                onChange={(e) => setForm({ ...form, bankName: e.target.value })}
              />
            </div>
            <div>
              <Label>IBAN</Label>
              <Input
                value={form.bankIban}
                onChange={(e) => setForm({ ...form, bankIban: e.target.value })}
              />
            </div>
            <div>
              <Label>BIC</Label>
              <Input
                value={form.bankBic}
                onChange={(e) => setForm({ ...form, bankBic: e.target.value })}
              />
            </div>
          </CardContent>
        </Card>

        {/* Email Settings */}
        <Card>
          <CardHeader>
            <CardTitle>{t('admin.settings.email')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {isSystemAdmin && (
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={form.emailEnabled}
                  onCheckedChange={(c) => setForm({ ...form, emailEnabled: !!c })}
                />
                <Label>{t('admin.settings.emailEnabled')}</Label>
              </div>
            )}

            {emailDisabled && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{t('admin.settings.emailDisabledWarning')}</AlertDescription>
              </Alert>
            )}

            <div className={emailDisabled ? 'opacity-50 pointer-events-none' : ''}>
              <div className="space-y-4">
                <div>
                  <Label>{t('admin.settings.emailProvider')}</Label>
                  <Select
                    value={form.emailProvider}
                    onValueChange={(v) => setForm({ ...form, emailProvider: v as EmailProvider })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="platform">
                        {t('admin.settings.emailProviderPlatform')}
                      </SelectItem>
                      <SelectItem value="smtp">
                        {t('admin.settings.emailProviderSmtp')}
                      </SelectItem>
                      <SelectItem value="graph">
                        {t('admin.settings.emailProviderGraph')}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {form.emailProvider === 'platform' && (
                  <Alert>
                    <Info className="h-4 w-4" />
                    <AlertDescription>{t('admin.settings.platformDescription')}</AlertDescription>
                  </Alert>
                )}

                {form.emailProvider === 'smtp' && (
                  <div className="space-y-4">
                    <Alert>
                      <Info className="h-4 w-4" />
                      <AlertDescription>{t('admin.settings.smtpDescription')}</AlertDescription>
                    </Alert>
                    <div>
                      <Label>{t('admin.settings.smtpHost')}</Label>
                      <Input
                        value={form.smtpHost}
                        onChange={(e) => setForm({ ...form, smtpHost: e.target.value })}
                        placeholder="smtp.example.com"
                      />
                    </div>
                    <div>
                      <Label>{t('admin.settings.smtpPort')}</Label>
                      <Input
                        type="number"
                        value={form.smtpPort}
                        onChange={(e) => setForm({ ...form, smtpPort: e.target.value })}
                        placeholder="587"
                      />
                    </div>
                    <div>
                      <Label>{t('admin.settings.smtpUser')}</Label>
                      <Input
                        value={form.smtpUser}
                        onChange={(e) => setForm({ ...form, smtpUser: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label>{t('admin.settings.smtpPass')}</Label>
                      <Input
                        type="password"
                        value={form.smtpPass}
                        onChange={(e) => setForm({ ...form, smtpPass: e.target.value })}
                        placeholder={t('admin.settings.smtpPassPlaceholder')}
                      />
                    </div>
                    <div>
                      <Label>{t('admin.settings.smtpFrom')}</Label>
                      <Input
                        value={form.smtpFrom}
                        onChange={(e) => setForm({ ...form, smtpFrom: e.target.value })}
                        placeholder="noreply@example.com"
                      />
                    </div>
                  </div>
                )}

                {form.emailProvider === 'graph' && (
                  <div className="space-y-4">
                    <Alert>
                      <Info className="h-4 w-4" />
                      <AlertDescription>
                        <p>{t('admin.settings.graphDescription')}</p>
                        <p className="mt-2 text-xs">{t('admin.settings.graphSetupInstructions')}</p>
                      </AlertDescription>
                    </Alert>
                    <div>
                      <Label>{t('admin.settings.graphClientId')}</Label>
                      <Input
                        value={form.graphClientId}
                        onChange={(e) => setForm({ ...form, graphClientId: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label>{t('admin.settings.graphClientSecret')}</Label>
                      <Input
                        type="password"
                        value={form.graphClientSecret}
                        onChange={(e) => setForm({ ...form, graphClientSecret: e.target.value })}
                        placeholder={t('admin.settings.graphClientSecretPlaceholder')}
                      />
                    </div>
                    <div>
                      <Label>{t('admin.settings.graphTenantId')}</Label>
                      <Input
                        value={form.graphTenantId}
                        onChange={(e) => setForm({ ...form, graphTenantId: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label>{t('admin.settings.graphFromEmail')}</Label>
                      <Input
                        type="email"
                        value={form.graphFromEmail}
                        onChange={(e) => setForm({ ...form, graphFromEmail: e.target.value })}
                        placeholder="noreply@yourdomain.com"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Button onClick={handleSave}>{t('common.save')}</Button>

        {/* Branding: Logo */}
        <Card>
          <CardHeader>
            <CardTitle>{t('admin.branding.logo')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {resolvedLogoUrl ? (
              <div className="flex items-center gap-4">
                <div className="w-20 h-20 border rounded-lg bg-gray-50 dark:bg-gray-900 flex items-center justify-center overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={resolvedLogoUrl}
                    alt="Logo"
                    className="max-w-full max-h-full object-contain"
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="h-4 w-4 mr-2" />
                    {t('admin.branding.changeLogo')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRemoveLogo}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    {t('admin.branding.removeLogo')}
                  </Button>
                </div>
              </div>
            ) : (
              <div
                className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
              >
                <ImageIcon className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                <p className="text-sm font-medium">{t('admin.branding.dropOrClick')}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {t('admin.branding.logoFormats')}
                </p>
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif,image/svg+xml"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileSelect(file);
                e.target.value = '';
              }}
            />
          </CardContent>
        </Card>

        {/* Branding: Colors */}
        <Card>
          <CardHeader>
            <CardTitle>{t('admin.branding.colors')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>{t('admin.branding.primaryColor')}</Label>
                <div className="flex items-center gap-2 mt-1">
                  <input
                    type="color"
                    value={brandingForm.primaryColor}
                    onChange={(e) =>
                      setBrandingForm({ ...brandingForm, primaryColor: e.target.value })
                    }
                    className="h-10 w-10 rounded border cursor-pointer"
                  />
                  <Input
                    value={brandingForm.primaryColor}
                    onChange={(e) =>
                      setBrandingForm({ ...brandingForm, primaryColor: e.target.value })
                    }
                    className="flex-1"
                  />
                </div>
              </div>
              <div>
                <Label>{t('admin.branding.secondaryColor')}</Label>
                <div className="flex items-center gap-2 mt-1">
                  <input
                    type="color"
                    value={brandingForm.secondaryColor}
                    onChange={(e) =>
                      setBrandingForm({ ...brandingForm, secondaryColor: e.target.value })
                    }
                    className="h-10 w-10 rounded border cursor-pointer"
                  />
                  <Input
                    value={brandingForm.secondaryColor}
                    onChange={(e) =>
                      setBrandingForm({ ...brandingForm, secondaryColor: e.target.value })
                    }
                    className="flex-1"
                  />
                </div>
              </div>
            </div>

            <div
              className="p-4 rounded-lg"
              style={{
                background: `linear-gradient(135deg, ${brandingForm.primaryColor}, ${brandingForm.secondaryColor})`,
              }}
            >
              <p className="text-white font-bold text-lg">{selectedCoop.name}</p>
              <p className="text-white/80 text-sm">{t('admin.branding.preview')}</p>
            </div>

            <Button onClick={handleBrandingSave}>{t('common.save')}</Button>
          </CardContent>
        </Card>
      </div>

      {/* Crop Dialog */}
      <Dialog open={cropDialogOpen} onOpenChange={setCropDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('admin.branding.cropLogo')}</DialogTitle>
            <DialogDescription>{t('admin.branding.cropDescription')}</DialogDescription>
          </DialogHeader>
          {imageSrc && (
            <div className="flex justify-center">
              <ReactCrop
                crop={crop}
                onChange={(c) => setCrop(c)}
                onComplete={(c) => setCompletedCrop(c)}
                aspect={1}
                className="max-h-[60vh]"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  ref={imgRef}
                  src={imageSrc}
                  alt="Crop preview"
                  onLoad={(e) => onImageLoad(e, setCrop)}
                  className="max-h-[60vh]"
                />
              </ReactCrop>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCropDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleUploadCropped} disabled={uploading || !completedCrop}>
              {uploading ? t('common.loading') : t('admin.branding.uploadLogo')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
