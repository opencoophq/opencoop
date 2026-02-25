'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { useAdmin } from '@/contexts/admin-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { api, resolveLogoUrl } from '@/lib/api';
import { Upload, Trash2, ImageIcon } from 'lucide-react';
import ReactCrop, {
  type Crop,
  type PixelCrop,
  centerCrop,
  makeAspectCrop,
} from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';

interface CoopPublicInfo {
  logoUrl?: string;
  primaryColor?: string;
  secondaryColor?: string;
  name?: string;
}

interface FormState {
  primaryColor: string;
  secondaryColor: string;
}

function getCroppedBlob(
  image: HTMLImageElement,
  crop: PixelCrop,
): Promise<Blob | null> {
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

export default function BrandingPage() {
  const t = useTranslations();
  const { selectedCoop } = useAdmin();
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({
    primaryColor: '#1e40af',
    secondaryColor: '#3b82f6',
  });
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  // Crop dialog state
  const [cropDialogOpen, setCropDialogOpen] = useState(false);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState<Crop>();
  const [completedCrop, setCompletedCrop] = useState<PixelCrop>();
  const imgRef = useRef<HTMLImageElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!selectedCoop) return;
    setLoading(true);
    api<CoopPublicInfo>(`/coops/${selectedCoop.slug}/public-info`)
      .then((coop) => {
        setLogoUrl(coop.logoUrl || null);
        setForm({
          primaryColor: coop.primaryColor || '#1e40af',
          secondaryColor: coop.secondaryColor || '#3b82f6',
        });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [selectedCoop]);

  const handleSave = async () => {
    if (!selectedCoop) return;
    try {
      await api(`/admin/coops/${selectedCoop.id}/branding`, { method: 'PUT', body: form });
      setMessage(t('common.savedSuccessfully'));
      setTimeout(() => setMessage(''), 3000);
    } catch {
      // ignore
    }
  };

  const handleFileSelect = useCallback((file: File) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'];
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
  }, [t]);

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
      setMessage(t('common.savedSuccessfully'));
      setTimeout(() => setMessage(''), 3000);
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
      setMessage(t('common.savedSuccessfully'));
      setTimeout(() => setMessage(''), 3000);
    } catch {
      // ignore
    }
  };

  if (!selectedCoop) return <p className="text-muted-foreground">{t('admin.selectCoop')}</p>;

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  const resolvedLogoUrl = resolveLogoUrl(logoUrl);

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold mb-6">{t('admin.branding.title')}</h1>
      {message && (
        <Alert className="mb-4">
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>{t('admin.branding.logo')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Current logo preview */}
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
            /* Drop zone for new upload */
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
                  value={form.primaryColor}
                  onChange={(e) => setForm({ ...form, primaryColor: e.target.value })}
                  className="h-10 w-10 rounded border cursor-pointer"
                />
                <Input
                  value={form.primaryColor}
                  onChange={(e) => setForm({ ...form, primaryColor: e.target.value })}
                  className="flex-1"
                />
              </div>
            </div>
            <div>
              <Label>{t('admin.branding.secondaryColor')}</Label>
              <div className="flex items-center gap-2 mt-1">
                <input
                  type="color"
                  value={form.secondaryColor}
                  onChange={(e) => setForm({ ...form, secondaryColor: e.target.value })}
                  className="h-10 w-10 rounded border cursor-pointer"
                />
                <Input
                  value={form.secondaryColor}
                  onChange={(e) => setForm({ ...form, secondaryColor: e.target.value })}
                  className="flex-1"
                />
              </div>
            </div>
          </div>

          <div
            className="p-4 rounded-lg"
            style={{
              background: `linear-gradient(135deg, ${form.primaryColor}, ${form.secondaryColor})`,
            }}
          >
            <p className="text-white font-bold text-lg">{selectedCoop.name}</p>
            <p className="text-white/80 text-sm">{t('admin.branding.preview')}</p>
          </div>

          <Button onClick={handleSave}>{t('common.save')}</Button>
        </CardContent>
      </Card>

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
