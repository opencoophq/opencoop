'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useTranslations, useLocale as useIntlLocale } from 'next-intl';
import { useAdmin } from '@/contexts/admin-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
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
import {
  Plus,
  Pencil,
  Trash2,
  Upload,
  ImageIcon,
  Copy,
  Check,
  ArrowLeft,
  ExternalLink,
} from 'lucide-react';
import { Link } from '@/i18n/routing';
import ReactCrop, {
  type Crop,
  type PixelCrop,
  centerCrop,
  makeAspectCrop,
} from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';

// ---------- Types ----------

interface Channel {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  termsUrl: string | null;
  active: boolean;
  isDefault: boolean;
  _count?: { shareClasses: number; projects: number };
  shareClasses?: { shareClass: ShareClassOption }[];
  projects?: { project: ProjectOption }[];
}

interface ShareClassOption {
  id: string;
  name: string;
  code: string;
  pricePerShare?: number;
  isActive?: boolean;
}

interface ProjectOption {
  id: string;
  name: string;
  isActive?: boolean;
}

interface ChannelFormState {
  slug: string;
  name: string;
  description: string;
  primaryColor: string;
  secondaryColor: string;
  termsUrl: string;
  shareClassIds: string[];
  projectIds: string[];
  active: boolean;
}

const emptyForm: ChannelFormState = {
  slug: '',
  name: '',
  description: '',
  primaryColor: '#1e40af',
  secondaryColor: '#3b82f6',
  termsUrl: '',
  shareClassIds: [],
  projectIds: [],
  active: true,
};

// ---------- Helpers ----------

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

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ---------- Component ----------

export default function ChannelsPage() {
  const t = useTranslations();
  const intlLocale = useIntlLocale();
  const { selectedCoop } = useAdmin();

  // List state
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  // Available share classes / projects for checkboxes
  const [allShareClasses, setAllShareClasses] = useState<ShareClassOption[]>([]);
  const [allProjects, setAllProjects] = useState<ProjectOption[]>([]);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null);
  const [form, setForm] = useState<ChannelFormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [slugTouched, setSlugTouched] = useState(false);

  // Delete confirmation
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingChannel, setDeletingChannel] = useState<Channel | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Logo crop state
  const [logoCropOpen, setLogoCropOpen] = useState(false);
  const [logoChannelId, setLogoChannelId] = useState<string | null>(null);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState<Crop>();
  const [completedCrop, setCompletedCrop] = useState<PixelCrop>();
  const imgRef = useRef<HTMLImageElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  // Clipboard
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // ---------- Data fetching ----------

  const fetchChannels = useCallback(async () => {
    if (!selectedCoop) return;
    try {
      const data = await api<Channel[]>(`/admin/coops/${selectedCoop.id}/channels`);
      setChannels(data);
    } catch {
      setError(t('admin.channels.loadError'));
    }
  }, [selectedCoop, t]);

  useEffect(() => {
    if (!selectedCoop) return;
    setLoading(true);
    Promise.all([
      api<Channel[]>(`/admin/coops/${selectedCoop.id}/channels`),
      api<ShareClassOption[]>(`/admin/coops/${selectedCoop.id}/share-classes`),
      api<ProjectOption[]>(`/admin/coops/${selectedCoop.id}/projects`),
    ])
      .then(([ch, sc, pr]) => {
        setChannels(ch);
        setAllShareClasses(sc);
        setAllProjects(pr);
      })
      .catch(() => setError(t('admin.channels.loadError')))
      .finally(() => setLoading(false));
  }, [selectedCoop, t]);

  // ---------- CRUD handlers ----------

  const showMessage = (msg: string) => {
    setMessage(msg);
    setTimeout(() => setMessage(''), 3000);
  };

  const openCreate = () => {
    setEditingChannel(null);
    setForm(emptyForm);
    setSlugTouched(false);
    setDialogOpen(true);
  };

  const openEdit = async (channel: Channel) => {
    if (!selectedCoop) return;
    try {
      // Fetch full channel with linked shareClasses/projects
      const full = await api<Channel>(
        `/admin/coops/${selectedCoop.id}/channels/${channel.id}`,
      );
      setEditingChannel(full);
      setForm({
        slug: full.slug,
        name: full.name,
        description: full.description || '',
        primaryColor: full.primaryColor || '#1e40af',
        secondaryColor: full.secondaryColor || '#3b82f6',
        termsUrl: full.termsUrl || '',
        shareClassIds: full.shareClasses?.map((sc) => sc.shareClass.id) || [],
        projectIds: full.projects?.map((p) => p.project.id) || [],
        active: full.active,
      });
      setSlugTouched(true);
      setDialogOpen(true);
    } catch {
      setError(t('admin.channels.loadError'));
    }
  };

  const handleSave = async () => {
    if (!selectedCoop) return;
    setSaving(true);
    setError('');
    try {
      if (editingChannel) {
        // Update
        const body: Record<string, unknown> = {
          name: form.name,
          description: form.description || undefined,
          primaryColor: form.primaryColor,
          secondaryColor: form.secondaryColor,
          termsUrl: form.termsUrl || undefined,
          shareClassIds: form.shareClassIds,
          projectIds: form.projectIds,
        };
        if (!editingChannel.isDefault) {
          body.slug = form.slug;
          body.active = form.active;
        }
        await api(`/admin/coops/${selectedCoop.id}/channels/${editingChannel.id}`, {
          method: 'PUT',
          body,
        });
      } else {
        // Create
        await api(`/admin/coops/${selectedCoop.id}/channels`, {
          method: 'POST',
          body: {
            slug: form.slug,
            name: form.name,
            description: form.description || undefined,
            primaryColor: form.primaryColor,
            secondaryColor: form.secondaryColor,
            termsUrl: form.termsUrl || undefined,
            shareClassIds: form.shareClassIds,
            projectIds: form.projectIds,
          },
        });
      }
      setDialogOpen(false);
      await fetchChannels();
      showMessage(t('common.savedSuccessfully'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.channels.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedCoop || !deletingChannel) return;
    setDeleting(true);
    try {
      await api(`/admin/coops/${selectedCoop.id}/channels/${deletingChannel.id}`, {
        method: 'DELETE',
      });
      setDeleteDialogOpen(false);
      setDeletingChannel(null);
      await fetchChannels();
      showMessage(t('admin.channels.deleted'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.channels.deleteError'));
    } finally {
      setDeleting(false);
    }
  };

  // ---------- Logo handlers ----------

  const handleFileSelect = useCallback(
    (file: File, channelId: string) => {
      const allowedTypes = [
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/gif',
        'image/svg+xml',
      ];
      if (!allowedTypes.includes(file.type)) {
        showMessage(t('admin.branding.invalidFileType'));
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        showMessage(t('admin.branding.fileTooLarge'));
        return;
      }

      setLogoChannelId(channelId);
      const reader = new FileReader();
      reader.onload = () => {
        setImageSrc(reader.result as string);
        setLogoCropOpen(true);
      };
      reader.readAsDataURL(file);
    },
    [t],
  );

  const handleUploadCropped = async () => {
    if (!selectedCoop || !imgRef.current || !completedCrop || !logoChannelId) return;
    setUploading(true);
    try {
      const blob = await getCroppedBlob(imgRef.current, completedCrop);
      if (!blob) throw new Error('Failed to crop image');

      const formData = new FormData();
      formData.append('file', blob, 'logo.png');

      await api<{ logoUrl: string }>(
        `/admin/coops/${selectedCoop.id}/channels/${logoChannelId}/logo`,
        { method: 'POST', body: formData },
      );

      setLogoCropOpen(false);
      setImageSrc(null);
      setLogoChannelId(null);
      await fetchChannels();
      showMessage(t('common.savedSuccessfully'));
    } catch {
      setError(t('admin.branding.uploadError'));
    } finally {
      setUploading(false);
    }
  };

  const handleRemoveLogo = async (channelId: string) => {
    if (!selectedCoop) return;
    try {
      await api(`/admin/coops/${selectedCoop.id}/channels/${channelId}/logo`, {
        method: 'DELETE',
      });
      await fetchChannels();
      showMessage(t('common.savedSuccessfully'));
    } catch {
      // ignore
    }
  };

  // ---------- Clipboard ----------

  const handleCopyUrl = async (channelId: string, url: string) => {
    await navigator.clipboard.writeText(url);
    setCopiedId(channelId);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // ---------- Checkbox toggles ----------

  const toggleShareClass = (id: string) => {
    setForm((prev) => ({
      ...prev,
      shareClassIds: prev.shareClassIds.includes(id)
        ? prev.shareClassIds.filter((x) => x !== id)
        : [...prev.shareClassIds, id],
    }));
  };

  const toggleProject = (id: string) => {
    setForm((prev) => ({
      ...prev,
      projectIds: prev.projectIds.includes(id)
        ? prev.projectIds.filter((x) => x !== id)
        : [...prev.projectIds, id],
    }));
  };

  // ---------- Render ----------

  if (!selectedCoop) return <p className="text-muted-foreground">{t('admin.selectCoop')}</p>;

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';

  return (
    <div className="max-w-3xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link
          href="/dashboard/admin/settings"
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-2xl font-bold flex-1">{t('admin.channels.title')}</h1>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-2" />
          {t('admin.channels.add')}
        </Button>
      </div>

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

      {/* Channel list */}
      {channels.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            {t('admin.channels.empty')}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {channels.map((channel) => {
            const resolved = resolveLogoUrl(channel.logoUrl);
            const regUrl = `${baseUrl}/${intlLocale}/${selectedCoop.slug}/${channel.slug}/register`;

            return (
              <Card key={channel.id}>
                <CardContent className="py-4">
                  <div className="flex items-start gap-4">
                    {/* Logo thumbnail */}
                    <div className="w-12 h-12 shrink-0 rounded-lg border bg-muted flex items-center justify-center overflow-hidden">
                      {resolved ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={resolved}
                          alt={channel.name}
                          className="max-w-full max-h-full object-contain"
                        />
                      ) : (
                        <div
                          className="w-full h-full"
                          style={{
                            background: `linear-gradient(135deg, ${channel.primaryColor || '#1e40af'}, ${channel.secondaryColor || '#3b82f6'})`,
                          }}
                        />
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold">{channel.name}</h3>
                        <span className="text-xs text-muted-foreground font-mono">
                          /{channel.slug}
                        </span>
                        {channel.isDefault && (
                          <Badge variant="secondary">{t('admin.channels.default')}</Badge>
                        )}
                        {channel.active ? (
                          <Badge variant="outline" className="text-green-700 border-green-300 dark:text-green-400 dark:border-green-700">
                            {t('admin.channels.active')}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground">
                            {t('admin.channels.inactive')}
                          </Badge>
                        )}
                      </div>

                      {channel.description && (
                        <p className="text-sm text-muted-foreground mt-1 line-clamp-1">
                          {channel.description}
                        </p>
                      )}

                      {/* Color swatch */}
                      <div className="flex items-center gap-2 mt-2">
                        <div
                          className="w-16 h-3 rounded-full"
                          style={{
                            background: `linear-gradient(135deg, ${channel.primaryColor || '#1e40af'}, ${channel.secondaryColor || '#3b82f6'})`,
                          }}
                        />
                        <span className="text-xs text-muted-foreground">
                          {channel._count?.shareClasses ?? 0} {t('admin.channels.shareClasses')} · {channel._count?.projects ?? 0} {t('admin.channels.projects')}
                        </span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => handleCopyUrl(channel.id, regUrl)}
                        className="rounded-md p-2 hover:bg-muted transition-colors"
                        title={t('admin.channels.copyUrl')}
                      >
                        {copiedId === channel.id ? (
                          <Check className="h-4 w-4 text-green-600" />
                        ) : (
                          <Copy className="h-4 w-4 text-muted-foreground" />
                        )}
                      </button>
                      <a
                        href={regUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-md p-2 hover:bg-muted transition-colors"
                        title={t('admin.channels.openUrl')}
                      >
                        <ExternalLink className="h-4 w-4 text-muted-foreground" />
                      </a>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEdit(channel)}
                        title={t('common.edit')}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setDeletingChannel(channel);
                          setDeleteDialogOpen(true);
                        }}
                        disabled={channel.isDefault}
                        title={channel.isDefault ? t('admin.channels.cannotDeleteDefault') : t('common.delete')}
                        className={channel.isDefault ? 'opacity-30' : 'text-destructive hover:text-destructive'}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* ==================== Create / Edit Dialog ==================== */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingChannel
                ? t('admin.channels.editTitle')
                : t('admin.channels.createTitle')}
            </DialogTitle>
            <DialogDescription>
              {editingChannel
                ? t('admin.channels.editDescription')
                : t('admin.channels.createDescription')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Name */}
            <div>
              <Label>{t('common.name')}</Label>
              <Input
                value={form.name}
                onChange={(e) => {
                  const name = e.target.value;
                  setForm((prev) => ({
                    ...prev,
                    name,
                    ...(slugTouched ? {} : { slug: slugify(name) }),
                  }));
                }}
              />
            </div>

            {/* Slug */}
            <div>
              <Label>{t('admin.channels.slug')}</Label>
              <Input
                value={form.slug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setForm((prev) => ({ ...prev, slug: slugify(e.target.value) }));
                }}
                disabled={editingChannel?.isDefault}
                placeholder="my-channel"
              />
              <p className="text-xs text-muted-foreground mt-1">
                {t('admin.channels.slugHint')}
              </p>
            </div>

            {/* Description */}
            <div>
              <Label>{t('admin.channels.description')}</Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                rows={3}
              />
            </div>

            {/* Colors */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>{t('admin.branding.primaryColor')}</Label>
                <div className="flex items-center gap-2 mt-1">
                  <input
                    type="color"
                    value={form.primaryColor}
                    onChange={(e) => setForm((prev) => ({ ...prev, primaryColor: e.target.value }))}
                    className="h-10 w-10 rounded border cursor-pointer"
                  />
                  <Input
                    value={form.primaryColor}
                    onChange={(e) => setForm((prev) => ({ ...prev, primaryColor: e.target.value }))}
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
                    onChange={(e) => setForm((prev) => ({ ...prev, secondaryColor: e.target.value }))}
                    className="h-10 w-10 rounded border cursor-pointer"
                  />
                  <Input
                    value={form.secondaryColor}
                    onChange={(e) => setForm((prev) => ({ ...prev, secondaryColor: e.target.value }))}
                    className="flex-1"
                  />
                </div>
              </div>
            </div>

            {/* Color preview */}
            <div
              className="p-3 rounded-lg"
              style={{
                background: `linear-gradient(135deg, ${form.primaryColor}, ${form.secondaryColor})`,
              }}
            >
              <p className="text-white font-bold">{form.name || t('admin.channels.preview')}</p>
              <p className="text-white/80 text-sm">{t('admin.branding.preview')}</p>
            </div>

            {/* Logo (only in edit mode — need a channelId for the upload endpoint) */}
            {editingChannel && (
              <div>
                <Label>{t('admin.branding.logo')}</Label>
                <div className="mt-1">
                  {resolveLogoUrl(editingChannel.logoUrl) ? (
                    <div className="flex items-center gap-3">
                      <div className="w-14 h-14 border rounded-lg bg-gray-50 dark:bg-gray-900 flex items-center justify-center overflow-hidden">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={resolveLogoUrl(editingChannel.logoUrl)!}
                          alt="Logo"
                          className="max-w-full max-h-full object-contain"
                        />
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                        >
                          <Upload className="h-4 w-4 mr-2" />
                          {t('admin.branding.changeLogo')}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          type="button"
                          onClick={() => handleRemoveLogo(editingChannel.id)}
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          {t('admin.branding.removeLogo')}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div
                      className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <ImageIcon className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
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
                      if (file && editingChannel) {
                        handleFileSelect(file, editingChannel.id);
                      }
                      e.target.value = '';
                    }}
                  />
                </div>
              </div>
            )}

            {/* Terms URL */}
            <div>
              <Label>{t('admin.settings.termsUrl')}</Label>
              <Input
                value={form.termsUrl}
                onChange={(e) => setForm((prev) => ({ ...prev, termsUrl: e.target.value }))}
                placeholder="https://..."
              />
            </div>

            {/* Share classes */}
            {allShareClasses.length > 0 && (
              <div>
                <Label>{t('admin.channels.shareClasses')}</Label>
                <div className="mt-2 space-y-2 max-h-40 overflow-y-auto border rounded-md p-3">
                  {allShareClasses.map((sc) => (
                    <div key={sc.id} className="flex items-center gap-2">
                      <Checkbox
                        checked={form.shareClassIds.includes(sc.id)}
                        onCheckedChange={() => toggleShareClass(sc.id)}
                      />
                      <span className="text-sm">
                        {sc.name} ({sc.code})
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Projects */}
            {allProjects.length > 0 && (
              <div>
                <Label>{t('admin.channels.projects')}</Label>
                <div className="mt-2 space-y-2 max-h-40 overflow-y-auto border rounded-md p-3">
                  {allProjects.map((p) => (
                    <div key={p.id} className="flex items-center gap-2">
                      <Checkbox
                        checked={form.projectIds.includes(p.id)}
                        onCheckedChange={() => toggleProject(p.id)}
                      />
                      <span className="text-sm">{p.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Active toggle (not for default channel) */}
            {editingChannel && !editingChannel.isDefault && (
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={form.active}
                  onCheckedChange={(c) => setForm((prev) => ({ ...prev, active: !!c }))}
                />
                <Label>{t('admin.channels.activeLabel')}</Label>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleSave} disabled={saving || !form.name || !form.slug}>
              {saving ? t('common.loading') : t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ==================== Delete Confirmation ==================== */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('admin.channels.deleteTitle')}</DialogTitle>
            <DialogDescription>
              {t('admin.channels.deleteConfirm', { name: deletingChannel?.name || '' })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? t('common.loading') : t('common.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ==================== Logo Crop Dialog ==================== */}
      <Dialog open={logoCropOpen} onOpenChange={setLogoCropOpen}>
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
            <Button variant="outline" onClick={() => setLogoCropOpen(false)}>
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
