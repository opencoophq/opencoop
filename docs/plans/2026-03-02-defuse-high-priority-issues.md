# Defuse High-Priority Issues Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix three high-priority anti-patterns: missing health endpoint, raw fetch calls bypassing the api() helper, and missing Docker log rotation.

**Architecture:** Add a NestJS Terminus health module checking Postgres+Redis, add an `apiFetch()` helper for blob downloads alongside the existing `api()` helper, and configure Docker json-file log rotation.

**Tech Stack:** @nestjs/terminus, existing api() helper, Docker Compose logging config

---

### Task 1: Add @nestjs/terminus dependency

**Files:**
- Modify: `apps/api/package.json`

**Step 1: Install the package**

Run: `cd /Users/wouterhermans/Developer/opencoop && pnpm add @nestjs/terminus --filter @opencoop/api`

Expected: Package added to apps/api/package.json dependencies

---

### Task 2: Create Health Module and Controller

**Files:**
- Create: `apps/api/src/modules/health/health.controller.ts`
- Create: `apps/api/src/modules/health/health.module.ts`

**Step 1: Create the health controller**

```typescript
// apps/api/src/modules/health/health.controller.ts
import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService, HealthCheckResult } from '@nestjs/terminus';
import { PrismaService } from '../../prisma/prisma.service';
import Redis from 'ioredis';

@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private prisma: PrismaService,
  ) {}

  @Get()
  @HealthCheck()
  check(): Promise<HealthCheckResult> {
    return this.health.check([
      async () => {
        await this.prisma.$queryRaw`SELECT 1`;
        return { database: { status: 'up' } };
      },
      async () => {
        const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
        const redis = new Redis(redisUrl);
        try {
          await redis.ping();
          return { redis: { status: 'up' } };
        } finally {
          redis.disconnect();
        }
      },
    ]);
  }
}
```

**Step 2: Create the health module**

```typescript
// apps/api/src/modules/health/health.module.ts
import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';

@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
})
export class HealthModule {}
```

**Step 3: Register HealthModule in AppModule**

Modify: `apps/api/src/app.module.ts`

Add import: `import { HealthModule } from './modules/health/health.module';`
Add `HealthModule` to the imports array.

**Step 4: Verify it compiles**

Run: `cd /Users/wouterhermans/Developer/opencoop && pnpm --filter @opencoop/api build`
Expected: Build succeeds

**Step 5: Add Docker healthcheck to api service**

Modify: `deploy/docker-compose.yml` — add to the `api` service block:

```yaml
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3001/health"]
      interval: 10s
      timeout: 5s
      retries: 3
      start_period: 30s
```

Use `wget` because Alpine images include it (no curl). The `start_period` gives the API time to boot and connect to Postgres/Redis before Docker starts marking it unhealthy.

**Step 6: Commit**

```bash
git add apps/api/src/modules/health/ apps/api/package.json apps/api/src/app.module.ts deploy/docker-compose.yml pnpm-lock.yaml
git commit -m "feat: add /health endpoint with Postgres and Redis checks"
```

---

### Task 3: Add apiFetch() helper for blob downloads

**Files:**
- Modify: `apps/web/src/lib/api.ts`

The existing `api()` always calls `response.json()`, so it can't handle blob downloads. Add a lower-level `apiFetch()` that returns the raw `Response` object but still handles auth headers and 401 redirect.

**Step 1: Add apiFetch to api.ts**

Add this function after the existing `api()` function:

```typescript
export async function apiFetch(
  path: string,
  options: FetchOptions = {},
): Promise<Response> {
  const token =
    typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;

  const { body, headers: customHeaders, ...rest } = options;
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;

  const headers: Record<string, string> = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...((customHeaders as Record<string, string>) || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...rest,
    headers,
    body: isFormData ? (body as FormData) : body ? JSON.stringify(body) : undefined,
  });

  if (response.status === 401) {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    throw new Error('Unauthorized');
  }

  if (!response.ok) {
    if (response.status === 403) {
      const error = await response.clone().json().catch(() => ({}));
      if (error.code === 'SUBSCRIPTION_REQUIRED' && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('subscription-required'));
      }
    }
    throw new Error(`HTTP ${response.status}`);
  }

  return response;
}
```

**Step 2: Commit**

```bash
git add apps/web/src/lib/api.ts
git commit -m "feat: add apiFetch() helper for raw Response access (blob downloads)"
```

---

### Task 4: Convert dashboard/layout.tsx to use api()

**Files:**
- Modify: `apps/web/src/app/[locale]/dashboard/layout.tsx`

**Step 1: Add import**

Add `import { api } from '@/lib/api';` at the top.

**Step 2: Convert the /auth/me fetch (lines 80-95)**

Replace:
```typescript
fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/auth/me`, {
  headers: { Authorization: `Bearer ${token}` },
})
  .then((res) => res.json())
  .then((data) => { ... })
  .catch(() => {});
```

With:
```typescript
api<{ emailVerified?: boolean; adminCoops?: typeof adminCoops }>('/auth/me')
  .then((data) => {
    setEmailVerified(data.emailVerified ?? true);
    if (data.adminCoops) {
      setAdminCoops(data.adminCoops);
      if (data.adminCoops.length > 0 && !selectedCoop) {
        setSelectedCoop(data.adminCoops[0]);
      }
    }
  })
  .catch(() => {});
```

Remove the `token` variable from the `/auth/me` part of the useEffect (keep it for the `!token` check at the top).

**Step 3: Convert the /admin/coops/:id/stats fetch (lines 102-114)**

Replace the entire useEffect body:
```typescript
useEffect(() => {
  if (!selectedCoop) return;
  api<typeof adminStats>(`/admin/coops/${selectedCoop.id}/stats`)
    .then((data) => {
      if (data) setAdminStats(data);
    })
    .catch(() => {});
}, [selectedCoop]);
```

**Step 4: Convert handleResendVerification (lines 191-207)**

Replace:
```typescript
const handleResendVerification = async () => {
  setResendingVerification(true);
  setVerificationResent(false);
  try {
    await api('/auth/resend-verification', { method: 'POST' });
    setVerificationResent(true);
  } catch {
    // silently fail
  } finally {
    setResendingVerification(false);
  }
};
```

Remove the `token` variable and `if (!token) return;` from this function.

**Step 5: Commit**

```bash
git add apps/web/src/app/[locale]/dashboard/layout.tsx
git commit -m "refactor: use api() helper in dashboard layout"
```

---

### Task 5: Convert dashboard/system/coops/page.tsx

**Files:**
- Modify: `apps/web/src/app/[locale]/dashboard/system/coops/page.tsx`

**Step 1: Add import**

Add `import { api } from '@/lib/api';`

**Step 2: Convert fetchCoops (lines 77-97)**

Replace the fetch with:
```typescript
const fetchCoops = useCallback(async () => {
  setLoading(true);
  try {
    const data = await api<Coop[] | { data: Coop[] }>('/system/coops');
    setCoops(Array.isArray(data) ? data : data.data || []);
  } catch {
    // Handle error silently
  } finally {
    setLoading(false);
  }
}, []);
```

**Step 3: Convert onSubmit (lines 123-154)**

Replace the fetch with:
```typescript
const onSubmit = async (data: CoopForm) => {
  setSaving(true);
  setError(null);
  try {
    const url = editingCoop
      ? `/system/coops/${editingCoop.id}`
      : '/system/coops';
    await api(url, {
      method: editingCoop ? 'PUT' : 'POST',
      body: data,
    });
    setSuccess(t('common.success'));
    setDialogOpen(false);
    fetchCoops();
  } catch {
    setError(t('common.error'));
  } finally {
    setSaving(false);
  }
};
```

**Step 4: Commit**

```bash
git add apps/web/src/app/[locale]/dashboard/system/coops/page.tsx
git commit -m "refactor: use api() helper in system coops page"
```

---

### Task 6: Convert dashboard/documents/page.tsx

**Files:**
- Modify: `apps/web/src/app/[locale]/dashboard/documents/page.tsx`

**Step 1: Add apiFetch import**

Change import to: `import { api, apiFetch } from '@/lib/api';`

**Step 2: Convert handleDownload (lines 46-69)**

Replace the raw fetch with:
```typescript
const handleDownload = async (doc: DocumentData) => {
  if (!shareholderId) return;
  setDownloadError(null);
  try {
    const response = await apiFetch(
      `/shareholders/${shareholderId}/documents/${doc.id}/download`,
    );
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = doc.filePath.split('/').pop() || 'document.pdf';
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();
  } catch {
    setDownloadError(t('personalData.downloadError'));
  }
};
```

**Step 3: Commit**

```bash
git add apps/web/src/app/[locale]/dashboard/documents/page.tsx
git commit -m "refactor: use apiFetch() helper in documents page"
```

---

### Task 7: Convert dashboard/admin/dividends/page.tsx

**Files:**
- Modify: `apps/web/src/app/[locale]/dashboard/admin/dividends/page.tsx`

**Step 1: Add import**

Add `import { api } from '@/lib/api';`

**Step 2: Convert all 4 fetch calls**

fetchPeriods (lines 90-115):
```typescript
const fetchPeriods = useCallback(async () => {
  if (!selectedCoop) return;
  setLoading(true);
  try {
    const data = await api<DividendPeriod[] | { data: DividendPeriod[] }>(
      `/admin/coops/${selectedCoop.id}/dividends`,
    );
    setPeriods(Array.isArray(data) ? data : data.data || []);
  } catch {
    // Handle error silently
  } finally {
    setLoading(false);
  }
}, [selectedCoop]);
```

onSubmit (lines 132-167):
```typescript
const onSubmit = async (data: DividendPeriodForm) => {
  if (!selectedCoop) return;
  setSaving(true);
  setError(null);
  try {
    await api(`/admin/coops/${selectedCoop.id}/dividends`, {
      method: 'POST',
      body: { ...data, paymentDate: data.paymentDate || undefined },
    });
    setSuccess(t('common.success'));
    setDialogOpen(false);
    fetchPeriods();
  } catch {
    setError(t('common.error'));
  } finally {
    setSaving(false);
  }
};
```

handleCalculate (lines 169-193):
```typescript
const handleCalculate = async (period: DividendPeriod) => {
  if (!selectedCoop) return;
  try {
    await api(`/admin/coops/${selectedCoop.id}/dividends/${period.id}/calculate`, {
      method: 'POST',
    });
    setSuccess(t('common.success'));
    fetchPeriods();
  } catch {
    setError(t('common.error'));
  }
};
```

handleMarkPaid (lines 195-219):
```typescript
const handleMarkPaid = async (period: DividendPeriod) => {
  if (!selectedCoop || !confirm(t('admin.dividendDetail.confirmMarkPaid'))) return;
  try {
    await api(`/admin/coops/${selectedCoop.id}/dividends/${period.id}/mark-paid`, {
      method: 'POST',
    });
    setSuccess(t('common.success'));
    fetchPeriods();
  } catch {
    setError(t('common.error'));
  }
};
```

**Step 3: Commit**

```bash
git add apps/web/src/app/[locale]/dashboard/admin/dividends/page.tsx
git commit -m "refactor: use api() helper in dividends list page"
```

---

### Task 8: Convert dashboard/admin/dividends/[id]/page.tsx

**Files:**
- Modify: `apps/web/src/app/[locale]/dashboard/admin/dividends/[id]/page.tsx`

**Step 1: Add imports**

Add `import { api, apiFetch } from '@/lib/api';`

**Step 2: Convert all 4 fetch calls**

fetchPeriod (lines 70-94) — use `api()`:
```typescript
const data = await api<DividendPeriod>(
  `/admin/coops/${selectedCoop.id}/dividends/${dividendId}`,
);
setPeriod(data);
```

handleCalculate (lines 97-122) — use `api()`:
```typescript
const data = await api<DividendPeriod>(
  `/admin/coops/${selectedCoop.id}/dividends/${period.id}/calculate`,
  { method: 'POST' },
);
setPeriod(data);
setSuccess(t('common.success'));
```

handleMarkPaid (lines 124-150) — use `api()`:
```typescript
const data = await api<DividendPeriod>(
  `/admin/coops/${selectedCoop.id}/dividends/${period.id}/mark-paid`,
  { method: 'POST' },
);
setPeriod(data);
setSuccess(t('common.success'));
```

handleExport (lines 152-180) — use `apiFetch()`:
```typescript
const handleExport = async () => {
  if (!selectedCoop || !period) return;
  try {
    const response = await apiFetch(
      `/admin/coops/${selectedCoop.id}/dividends/${period.id}/export`,
    );
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dividends-${period.name}.csv`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  } catch {
    setError(t('common.error'));
  }
};
```

**Step 3: Commit**

```bash
git add apps/web/src/app/[locale]/dashboard/admin/dividends/[id]/page.tsx
git commit -m "refactor: use api()/apiFetch() in dividend detail page"
```

---

### Task 9: Convert dashboard/admin/projects/page.tsx

**Files:**
- Modify: `apps/web/src/app/[locale]/dashboard/admin/projects/page.tsx`

**Step 1: Add import**

Add `import { api } from '@/lib/api';`

**Step 2: Convert all 3 fetch calls**

fetchProjects (lines 94-118):
```typescript
const fetchProjects = useCallback(async () => {
  if (!selectedCoop) return;
  setLoading(true);
  try {
    const data = await api<Project[] | { data: Project[] }>(
      `/admin/coops/${selectedCoop.id}/projects`,
    );
    setProjects(Array.isArray(data) ? data : data.data || []);
  } catch {
    // Handle error silently
  } finally {
    setLoading(false);
  }
}, [selectedCoop]);
```

onSubmit (lines 154-196):
```typescript
const onSubmit = async (data: ProjectForm) => {
  if (!selectedCoop) return;
  setSaving(true);
  setError(null);
  try {
    const url = editingProject
      ? `/admin/coops/${selectedCoop.id}/projects/${editingProject.id}`
      : `/admin/coops/${selectedCoop.id}/projects`;
    await api(url, {
      method: editingProject ? 'PUT' : 'POST',
      body: {
        name: data.name,
        description: data.description || undefined,
        type: data.type,
        capacityKw: data.capacityKw ? Number(data.capacityKw) : undefined,
        estimatedAnnualMwh: data.estimatedAnnualMwh ? Number(data.estimatedAnnualMwh) : undefined,
        startDate: data.startDate || undefined,
        endDate: data.endDate || undefined,
        isActive: data.isActive,
      },
    });
    setSuccess(t('common.success'));
    setDialogOpen(false);
    fetchProjects();
  } catch {
    setError(t('common.error'));
  } finally {
    setSaving(false);
  }
};
```

handleDelete (lines 198-222):
```typescript
const handleDelete = async (project: Project) => {
  if (!confirm(t('common.confirm'))) return;
  try {
    await api(`/admin/coops/${selectedCoop?.id}/projects/${project.id}`, {
      method: 'DELETE',
    });
    setSuccess(t('common.success'));
    fetchProjects();
  } catch {
    setError(t('common.error'));
  }
};
```

**Step 3: Commit**

```bash
git add apps/web/src/app/[locale]/dashboard/admin/projects/page.tsx
git commit -m "refactor: use api() helper in projects page"
```

---

### Task 10: Convert dashboard/admin/bank-import/page.tsx

**Files:**
- Modify: `apps/web/src/app/[locale]/dashboard/admin/bank-import/page.tsx`

**Step 1: Add apiFetch import**

Change import to: `import { api, apiFetch } from '@/lib/api';`

**Step 2: Convert handleUpload (lines 72-95)**

Replace with:
```typescript
const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
  const file = e.target.files?.[0];
  if (!file || !selectedCoop) return;
  setUploading(true);
  const formData = new FormData();
  formData.append('file', file);
  try {
    await api(`/admin/coops/${selectedCoop.id}/bank-import`, {
      method: 'POST',
      body: formData,
    });
    loadData();
  } catch {
    // ignore
  } finally {
    setUploading(false);
    e.target.value = '';
  }
};
```

Note: `api()` already handles FormData (skips Content-Type header and doesn't JSON.stringify).

**Step 3: Commit**

```bash
git add apps/web/src/app/[locale]/dashboard/admin/bank-import/page.tsx
git commit -m "refactor: use api() helper in bank import page"
```

---

### Task 11: Convert components/reports/export-buttons.tsx

**Files:**
- Modify: `apps/web/src/components/reports/export-buttons.tsx`

**Step 1: Add import**

Add `import { apiFetch } from '@/lib/api';`

**Step 2: Convert handleDownload (lines 21-55)**

Replace with:
```typescript
const handleDownload = async (format: 'csv' | 'pdf') => {
  if (!selectedCoop) return;
  setDownloading(format);

  try {
    const queryString = new URLSearchParams(params).toString();
    const response = await apiFetch(
      `/admin/coops/${selectedCoop.id}/reports/${reportType}/${format}?${queryString}`,
    );

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${reportType}-${Date.now()}.${format}`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();
  } catch {
    // Silent failure - download just doesn't happen
  } finally {
    setDownloading(null);
  }
};
```

**Step 3: Commit**

```bash
git add apps/web/src/components/reports/export-buttons.tsx
git commit -m "refactor: use apiFetch() helper in export buttons"
```

---

### Task 12: Add Docker log rotation

**Files:**
- Modify: `deploy/docker-compose.yml`

**Step 1: Add logging config to api and web services**

Add to both the `api` and `web` service blocks:

```yaml
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
```

This caps each container's logs at 30MB total (3 files x 10MB), rotated automatically.

**Step 2: Commit**

```bash
git add deploy/docker-compose.yml
git commit -m "infra: add Docker log rotation for api and web services"
```

---

### Task 13: Verify build

**Step 1: Build the API to ensure health module compiles**

Run: `cd /Users/wouterhermans/Developer/opencoop && pnpm --filter @opencoop/api build`
Expected: Success

**Step 2: Build the web app to ensure all api() conversions compile**

Run: `cd /Users/wouterhermans/Developer/opencoop && pnpm --filter @opencoop/web build`
Expected: Success

**Step 3: Final commit (if any fixes needed)**

Only commit if build failures required fixes.
