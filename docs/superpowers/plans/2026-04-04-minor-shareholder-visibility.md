# Minor Shareholder Visibility & Management — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let parents see and manage their minor children's shares from the shareholder dashboard, with buy/sell/profile-edit capabilities and mandatory birthDate for MINOR shareholders.

**Architecture:** Extend the existing `/auth/me` profile endpoint to also return MINOR shareholders registered by the current user. Widen the `verifyShareholder` guard in `shareholder-actions.controller.ts` to allow parents to act on behalf of their children. Add a separate section per child on the shares page. Add a new admin endpoint to return minors for preview mode.

**Tech Stack:** NestJS (backend), Next.js 14 App Router + React 18 (frontend), Prisma 6 (ORM), next-intl (i18n)

**Spec:** `docs/superpowers/specs/2026-04-04-minor-shareholder-visibility-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `apps/api/src/modules/auth/auth.service.ts` | Add `registeredShareholders` to `getProfile()` query, compute vested shares for minors |
| Modify | `apps/api/src/modules/shareholders/shareholder-actions.controller.ts` | Widen `verifyShareholder()` to allow parent access to MINOR records |
| Modify | `apps/api/src/modules/shareholders/shareholders.service.ts` | Add birthDate enforcement in `create()` and `update()`, add `findMinorsByUserId()` method |
| Modify | `apps/api/src/modules/admin/admin.controller.ts` | Add `GET /admin/coops/:coopId/shareholders/:id/minors` endpoint |
| Modify | `apps/web/src/app/[locale]/dashboard/shares/page.tsx` | Add minor shareholder sections with buy/sell/profile-edit |
| Modify | `apps/web/src/app/[locale]/dashboard/page.tsx` | Include minor shares in dashboard stats |
| Modify | `apps/web/messages/nl.json` | Add new i18n keys |
| Modify | `apps/web/messages/en.json` | Add new i18n keys |
| Modify | `apps/web/messages/fr.json` | Add new i18n keys |
| Modify | `apps/web/messages/de.json` | Add new i18n keys |

---

### Task 1: Create feature branch

**Files:** None

- [ ] **Step 1: Create and switch to feature branch**

```bash
cd /Users/wouterhermans/Developer/opencoop
git checkout -b feature/minor-shareholder-visibility
```

- [ ] **Step 2: Verify clean state**

```bash
git status
```

Expected: On branch `feature/minor-shareholder-visibility`, nothing to commit.

---

### Task 2: Backend — Add `registeredShareholders` to `getProfile()`

**Files:**
- Modify: `apps/api/src/modules/auth/auth.service.ts:422-531`

- [ ] **Step 1: Add `registeredShareholders` include to the Prisma query**

In `apps/api/src/modules/auth/auth.service.ts`, inside `getProfile()`, add a new `registeredShareholders` include block after the existing `shareholders` include (after line 462). Add this right after the closing `},` of the `shareholders` include block:

```typescript
        registeredShareholders: {
          where: { type: 'MINOR' },
          include: {
            coop: {
              select: {
                id: true,
                name: true,
                slug: true,
                bankIban: true,
                bankBic: true,
                minimumHoldingPeriod: true,
                channels: {
                  where: { isDefault: true },
                  select: { logoUrl: true },
                  take: 1,
                },
              },
            },
            registrations: {
              include: {
                shareClass: true,
                project: true,
                payments: { orderBy: { bankDate: 'asc' } },
                giftClaimedByShareholder: {
                  select: { id: true, firstName: true, lastName: true },
                },
              },
            },
            dividendPayouts: {
              include: {
                dividendPeriod: {
                  include: {
                    coop: { select: { name: true } },
                  },
                },
              },
            },
            documents: {
              orderBy: { generatedAt: 'desc' },
            },
          },
        },
```

- [ ] **Step 2: Compute vested shares for minor shareholders**

After the existing `shareholdersWithComputed` block (around line 526), add computation for minors. Insert this after `shareholdersWithComputed` and before the sort:

```typescript
    // Compute vested shares for minor shareholders too
    const minorShareholdersWithComputed = (safeUser as any).registeredShareholders?.map((s: any) => ({
      ...s,
      registrations: s.registrations.map((reg: any) => {
        if (reg.payments) {
          const totalPaid = computeTotalPaid(reg.payments);
          const pricePerShare = Number(reg.pricePerShare);
          const sharesOwned = computeVestedShares(totalPaid, pricePerShare, reg.quantity);
          return {
            ...reg,
            totalPaid,
            sharesOwned,
            sharesRemaining: reg.quantity - sharesOwned,
            fullyPaid: totalPaid >= Number(reg.totalAmount),
          };
        }
        return reg;
      }),
    })) ?? [];
```

- [ ] **Step 3: Include `minorShareholders` in the return value**

In the return statement (around line 533), add `minorShareholders` after `shareholders`:

```typescript
    return {
      ...safeUser,
      shareholders: shareholdersWithComputed,
      minorShareholders: minorShareholdersWithComputed,
      emailVerified,
      // ... rest stays the same
```

Also add minor shareholders to the `shareholderCoops` mapping. After the existing `shareholderCoops` line, add:

```typescript
      minorShareholderCoops: (safeUser as any).registeredShareholders?.map((s: any) => {
        const { channels, ...rest } = s.coop as typeof s.coop & { channels?: { logoUrl: string | null }[] };
        return { ...rest, logoUrl: channels?.[0]?.logoUrl ?? null };
      }) ?? [],
```

- [ ] **Step 4: Verify the API compiles**

```bash
cd /Users/wouterhermans/Developer/opencoop && pnpm --filter api build
```

Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/auth/auth.service.ts
git commit -m "feat: include minor shareholders in getProfile() response"
```

---

### Task 3: Backend — Widen `verifyShareholder()` guard for parents

**Files:**
- Modify: `apps/api/src/modules/shareholders/shareholder-actions.controller.ts:142-157`

- [ ] **Step 1: Update `verifyShareholder()` to allow parent access**

Replace lines 142-157 in `shareholder-actions.controller.ts`:

```typescript
  private async verifyShareholder(shareholderId: string, userId: string) {
    const shareholder = await this.prisma.shareholder.findUnique({
      where: { id: shareholderId },
      include: { coop: { select: { id: true, minimumHoldingPeriod: true } } },
    });

    if (!shareholder) {
      throw new NotFoundException('Shareholder not found');
    }

    const isOwner = shareholder.userId === userId;
    const isParentOfMinor = shareholder.type === 'MINOR' && shareholder.registeredByUserId === userId;

    if (!isOwner && !isParentOfMinor) {
      throw new ForbiddenException('You can only manage your own shareholder records');
    }

    return shareholder;
  }
```

- [ ] **Step 2: Verify build**

```bash
cd /Users/wouterhermans/Developer/opencoop && pnpm --filter api build
```

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/shareholders/shareholder-actions.controller.ts
git commit -m "feat: allow parents to manage minor shareholder records"
```

---

### Task 4: Backend — Enforce birthDate for MINOR shareholders

**Files:**
- Modify: `apps/api/src/modules/shareholders/shareholders.service.ts:141-217` (create) and `:219-340` (update)

- [ ] **Step 1: Add birthDate validation in `create()`**

In `shareholders.service.ts`, inside `create()`, right after the email duplicate check block (after line 149, before line 151), add:

```typescript
    // birthDate is required for MINOR shareholders
    if (dto.type === 'MINOR' && !dto.birthDate) {
      throw new BadRequestException('birthDate is required for MINOR shareholders');
    }
```

- [ ] **Step 2: Add birthDate validation in `update()`**

In `shareholders.service.ts`, inside `update()`, after the type change detection logic (after line 247, before line 249), add:

```typescript
    // birthDate is required for MINOR shareholders
    const effectiveType = rest.type || existing.type;
    const effectiveBirthDate = birthDate !== undefined ? birthDate : existing.birthDate;
    if (effectiveType === 'MINOR' && !effectiveBirthDate) {
      throw new BadRequestException('birthDate is required for MINOR shareholders');
    }
```

- [ ] **Step 3: Verify build**

```bash
cd /Users/wouterhermans/Developer/opencoop && pnpm --filter api build
```

Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/shareholders/shareholders.service.ts
git commit -m "feat: enforce birthDate requirement for MINOR shareholders"
```

---

### Task 5: Backend — Add admin endpoint for minor shareholders

**Files:**
- Modify: `apps/api/src/modules/shareholders/shareholders.service.ts`
- Modify: `apps/api/src/modules/admin/admin.controller.ts`

- [ ] **Step 1: Add `findMinorsByUserId()` method to shareholders service**

In `shareholders.service.ts`, add this method after the `findById()` method (after line 139):

```typescript
  async findMinorsByUserId(userId: string, coopId: string) {
    if (!userId) return [];

    const minors = await this.prisma.shareholder.findMany({
      where: {
        coopId,
        type: 'MINOR',
        registeredByUserId: userId,
      },
      include: {
        registrations: {
          orderBy: { createdAt: 'desc' },
          include: {
            shareClass: true,
            project: true,
            payments: { orderBy: { bankDate: 'asc' } },
            soldBy: {
              where: { type: 'SELL', status: { in: ['PENDING', 'PENDING_PAYMENT', 'ACTIVE', 'COMPLETED'] } },
              select: { quantity: true, status: true },
            },
          },
        },
      },
      orderBy: { firstName: 'asc' },
    });

    return minors.map((minor) => ({
      ...minor,
      registrations: minor.registrations.map((reg) => {
        if (reg.type === 'BUY') {
          const totalPaid = computeTotalPaid(reg.payments);
          const pricePerShare = Number(reg.pricePerShare);
          const vestedShares = computeVestedShares(totalPaid, pricePerShare, reg.quantity);
          const soldQty = (reg.soldBy ?? []).reduce((sum, s) => sum + s.quantity, 0);
          const sharesOwned = Math.max(0, vestedShares - soldQty);
          return { ...reg, sharesOwned, sharesRemaining: reg.quantity - vestedShares };
        }
        return reg;
      }),
    }));
  }
```

- [ ] **Step 2: Add admin endpoint for fetching minors**

In `admin.controller.ts`, add a new endpoint after the `getShareholder()` method (after line 374):

```typescript
  @Get('shareholders/:id/minors')
  @RequirePermission('canManageShareholders')
  @ApiOperation({ summary: 'Get minor shareholders registered by a shareholder' })
  async getShareholderMinors(
    @Param('coopId') coopId: string,
    @Param('id') id: string,
  ) {
    const shareholder = await this.shareholdersService.findById(id, coopId);
    if (!shareholder.userId) return [];
    return this.shareholdersService.findMinorsByUserId(shareholder.userId, coopId);
  }
```

- [ ] **Step 3: Verify build**

```bash
cd /Users/wouterhermans/Developer/opencoop && pnpm --filter api build
```

Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/shareholders/shareholders.service.ts apps/api/src/modules/admin/admin.controller.ts
git commit -m "feat: add admin endpoint for minor shareholders lookup"
```

---

### Task 6: i18n — Add translation keys

**Files:**
- Modify: `apps/web/messages/nl.json`
- Modify: `apps/web/messages/en.json`
- Modify: `apps/web/messages/fr.json`
- Modify: `apps/web/messages/de.json`

Note: Several keys already exist (`childShares`, `forMinor`, `managedShares`, `ownShares`). We only need to add profile-related keys.

- [ ] **Step 1: Add missing keys to all 4 locale files**

In each file, inside the `"shares"` object (after the `"previewMode"` line), add:

**nl.json:**
```json
    "childSharesOf": "Aandelen van {name}",
    "editChildProfile": "Profiel bewerken",
    "childProfileTitle": "Profiel van {name}",
    "birthDateLabel": "Geboortedatum",
    "birthDateRequired": "Geboortedatum is verplicht"
```

**en.json:**
```json
    "childSharesOf": "Shares of {name}",
    "editChildProfile": "Edit profile",
    "childProfileTitle": "Profile of {name}",
    "birthDateLabel": "Date of birth",
    "birthDateRequired": "Date of birth is required"
```

**fr.json:**
```json
    "childSharesOf": "Parts de {name}",
    "editChildProfile": "Modifier le profil",
    "childProfileTitle": "Profil de {name}",
    "birthDateLabel": "Date de naissance",
    "birthDateRequired": "La date de naissance est obligatoire"
```

**de.json:**
```json
    "childSharesOf": "Anteile von {name}",
    "editChildProfile": "Profil bearbeiten",
    "childProfileTitle": "Profil von {name}",
    "birthDateLabel": "Geburtsdatum",
    "birthDateRequired": "Geburtsdatum ist erforderlich"
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/messages/nl.json apps/web/messages/en.json apps/web/messages/fr.json apps/web/messages/de.json
git commit -m "feat: add i18n keys for minor shareholder sections"
```

---

### Task 7: Frontend — Add minor shareholder sections to shares page

**Files:**
- Modify: `apps/web/src/app/[locale]/dashboard/shares/page.tsx`

This is the largest task. The shares page needs to:
1. Fetch minor shareholders from the profile response
2. Render a Card per minor with their registrations table
3. Support buy/sell/profile-edit per minor

- [ ] **Step 1: Add minor shareholder interfaces and state**

At the top of `page.tsx`, after the `ShareholderData` interface (line 57), add:

```typescript
interface MinorShareholderData extends ShareholderData {
  firstName: string;
  lastName: string;
  birthDate?: string;
  phone?: string;
  address?: {
    street?: string;
    number?: string;
    postalCode?: string;
    city?: string;
    country?: string;
  };
}
```

Inside the `SharesPage` component, after the existing state declarations (around line 119), add:

```typescript
  // Minor shareholders
  const [minorShareholders, setMinorShareholders] = useState<MinorShareholderData[]>([]);

  // Child profile edit dialog state
  const [editChildOpen, setEditChildOpen] = useState(false);
  const [editChild, setEditChild] = useState<MinorShareholderData | null>(null);
  const [editChildForm, setEditChildForm] = useState({ firstName: '', lastName: '', birthDate: '', phone: '' });
  const [editChildSaving, setEditChildSaving] = useState(false);

  // Track which minor's buy/sell dialog is open
  const [activeMinorId, setActiveMinorId] = useState<string | null>(null);
```

- [ ] **Step 2: Update data loading to include minors**

In the `loadShares` function, update the **normal mode** branch (around line 165-182). Replace:

```typescript
        const profile = await api<{ shareholders: ShareholderData[] }>('/auth/me');
```

with:

```typescript
        const profile = await api<{
          shareholders: ShareholderData[];
          minorShareholders?: MinorShareholderData[];
        }>('/auth/me');
```

After the `setShareClasses` call (line 181), add:

```typescript
          // Load minor shareholders
          if (profile.minorShareholders?.length) {
            setMinorShareholders(profile.minorShareholders);
          }
```

For the **preview mode** branch (around line 125-162), after setting the parent shareholder, add:

```typescript
          // In preview mode, also load minors if admin
          if (selectedCoop && preview.userId) {
            try {
              const minors = await api<MinorShareholderData[]>(
                `/admin/coops/${selectedCoop.id}/shareholders/${previewShareholderId}/minors`,
              );
              setMinorShareholders(minors || []);
            } catch {
              // ignore - minors endpoint may not exist for shareholders without userId
            }
          }
```

Note: The preview response from `/admin/coops/:coopId/shareholders/:id` doesn't include `userId` by default. You'll need to check the `findById` response — it already returns the full shareholder which includes `userId`. Use `preview.userId` to decide whether to fetch minors.

Update the preview type assertion at line 127 to include `userId`:

```typescript
            api<{
              id: string;
              userId?: string;
              bankIban?: string;
              bankBic?: string;
              registrations: RegistrationData[];
            }>(`/admin/coops/${selectedCoop.id}/shareholders/${previewShareholderId}`),
```

Store it for later use. After `const sh: ShareholderData = {` block, add:
```typescript
          const previewUserId = preview.userId;
```

Then use `previewUserId` instead of `preview.userId` in the minors fetch block.

- [ ] **Step 3: Add helper functions for minor actions**

Before the `return` statement, add helper functions for buying/selling on behalf of a minor:

```typescript
  const handleMinorBuy = async (minorId: string) => {
    setActiveMinorId(minorId);
    setBuyOpen(true);
    setBuySuccess(false);
    setBuyError('');
    setBuyPaymentDetails(null);
    setBuyShareClassId('');
    setBuyQuantity(1);

    // Load share classes for this minor
    try {
      const sc = await api<ShareClassData[]>(`/shareholders/${minorId}/share-classes`);
      setShareClasses(sc || []);
    } catch {
      setShareClasses([]);
    }
  };

  const handleMinorSellDialog = (minorId: string, registrationId: string) => {
    setActiveMinorId(minorId);
    setSellRegistrationId(registrationId);
    setSellQuantity(1);
    setSellOpen(true);
    setSellSuccess(false);
    setSellError('');
  };

  const openEditChildDialog = (minor: MinorShareholderData) => {
    setEditChild(minor);
    setEditChildForm({
      firstName: minor.firstName || '',
      lastName: minor.lastName || '',
      birthDate: minor.birthDate ? minor.birthDate.split('T')[0] : '',
      phone: minor.phone || '',
    });
    setEditChildOpen(true);
  };

  const handleSaveChildProfile = async () => {
    if (!editChild) return;
    setEditChildSaving(true);
    try {
      await api(`/shareholders/${editChild.id}/profile`, {
        method: 'PUT',
        body: JSON.stringify({
          firstName: editChildForm.firstName,
          lastName: editChildForm.lastName,
          birthDate: editChildForm.birthDate || undefined,
          phone: editChildForm.phone || undefined,
        }),
      });
      // Reload the page data
      window.location.reload();
    } catch {
      // ignore
    } finally {
      setEditChildSaving(false);
    }
  };
```

- [ ] **Step 4: Update handleBuy and handleSell to use activeMinorId**

The existing `handleBuy` function uses `shareholder.id` to call the buy endpoint. Update it to use `activeMinorId || shareholder.id`. Find the `handleBuy` function and update the API call:

Replace `shareholder.id` with `activeMinorId || shareholder?.id` in the buy request URL. For example, if the existing code has:

```typescript
await api(`/shareholders/${shareholder.id}/buy`, { ... })
```

Change it to:

```typescript
await api(`/shareholders/${activeMinorId || shareholder?.id}/buy`, { ... })
```

Similarly, update `handleSell` to use `activeMinorId || shareholder?.id` in the sell request URL.

Also update `openSellDialog` calls from the parent table to reset `activeMinorId` to `null`:

```typescript
  const openSellDialog = (registrationId: string) => {
    setActiveMinorId(null);
    setSellRegistrationId(registrationId);
    // ... rest stays the same
  };
```

And update the parent's "Buy" button click handler to also reset `activeMinorId`:

```typescript
onClick={() => {
  setActiveMinorId(null);
  setBuyOpen(true);
  // ... rest stays the same
}}
```

- [ ] **Step 5: Add minor shareholder sections to the JSX**

After the closing `</Card>` of the parent's "Mijn aandelen" card (around line 496), and before the Bank Details Dialog (line 498), add:

```tsx
      {/* Minor shareholder sections */}
      {minorShareholders.map((minor) => {
        const minorRegs = (minor.registrations || []).filter(
          (r) => r.status === 'ACTIVE' || r.status === 'PENDING_PAYMENT' || r.status === 'COMPLETED',
        );
        return (
          <Card key={minor.id} className="mt-6">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                {t('shares.childSharesOf', { name: `${minor.firstName} ${minor.lastName}` })}
                {!isPreviewMode && (
                  <Button variant="ghost" size="sm" onClick={() => openEditChildDialog(minor)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                )}
              </CardTitle>
              {!isPreviewMode && (
                <Button onClick={() => handleMinorBuy(minor.id)}>
                  {t('shares.buyShares')}
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {minorRegs.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">{t('common.noResults')}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('shares.shareClass')}</TableHead>
                      <TableHead>{t('shares.project')}</TableHead>
                      <TableHead className="text-right">{t('shares.quantity')}</TableHead>
                      <TableHead className="text-right">{t('shares.pricePerShare')}</TableHead>
                      <TableHead className="text-right">{t('shares.totalValue')}</TableHead>
                      <TableHead>{t('shares.purchaseDate')}</TableHead>
                      <TableHead>{t('common.status')}</TableHead>
                      <TableHead>{t('common.actions')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {minorRegs.map((reg) => (
                      <TableRow key={reg.id}>
                        <TableCell className="font-medium">
                          {reg.shareClass.name} ({reg.shareClass.code})
                        </TableCell>
                        <TableCell>{reg.project?.name || '-'}</TableCell>
                        <TableCell className="text-right">{reg.sharesOwned ?? reg.quantity}</TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(Number(reg.pricePerShare), locale)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatCurrency((reg.sharesOwned ?? reg.quantity) * Number(reg.pricePerShare), locale)}
                        </TableCell>
                        <TableCell>
                          {new Date(reg.registerDate).toLocaleDateString(locale)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(reg.status)}>{t(`transactions.statuses.${reg.status}`)}</Badge>
                        </TableCell>
                        <TableCell>
                          {!isPreviewMode && (reg.status === 'ACTIVE' || reg.status === 'COMPLETED') && (() => {
                            const holdingMonths = minor?.coop?.minimumHoldingPeriod || 0;
                            const minDate = new Date(reg.registerDate);
                            minDate.setMonth(minDate.getMonth() + holdingMonths);
                            const canSell = holdingMonths === 0 || new Date() >= minDate;
                            return canSell ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleMinorSellDialog(minor.id, reg.id)}
                              >
                                <TrendingDown className="h-4 w-4 mr-1" />
                                {t('shares.sellBack')}
                              </Button>
                            ) : (
                              <span className="text-xs text-muted-foreground">
                                {t('shares.reasonMinHoldingPeriod', { months: holdingMonths })}
                              </span>
                            );
                          })()}
                          {reg.status === 'PENDING_PAYMENT' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => showPaymentForRegistration(reg)}
                            >
                              <QrCode className="h-4 w-4 mr-1" />
                              {t('shares.awaitingPayment')}
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        );
      })}
```

- [ ] **Step 6: Add the `Pencil` icon import**

At the top of the file, in the lucide-react import (line 27), add `Pencil`:

```typescript
import { TrendingDown, QrCode, Gift, Download, FileDown, Pencil } from 'lucide-react';
```

- [ ] **Step 7: Add the child profile edit dialog**

After the Sell Shares Dialog closing `</Dialog>` (around line 770), before the closing `</div>` of the component, add:

```tsx
      {/* Edit Child Profile Dialog */}
      <Dialog open={editChildOpen} onOpenChange={setEditChildOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editChild ? t('shares.childProfileTitle', { name: `${editChild.firstName} ${editChild.lastName}` }) : ''}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t('profile.firstName')}</Label>
                <Input
                  value={editChildForm.firstName}
                  onChange={(e) => setEditChildForm((f) => ({ ...f, firstName: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>{t('profile.lastName')}</Label>
                <Input
                  value={editChildForm.lastName}
                  onChange={(e) => setEditChildForm((f) => ({ ...f, lastName: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t('shares.birthDateLabel')} *</Label>
              <Input
                type="date"
                value={editChildForm.birthDate}
                onChange={(e) => setEditChildForm((f) => ({ ...f, birthDate: e.target.value }))}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>{t('profile.phone')}</Label>
              <Input
                value={editChildForm.phone}
                onChange={(e) => setEditChildForm((f) => ({ ...f, phone: e.target.value }))}
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditChildOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button
                onClick={handleSaveChildProfile}
                disabled={editChildSaving || !editChildForm.firstName || !editChildForm.lastName || !editChildForm.birthDate}
              >
                {editChildSaving ? t('common.loading') : t('common.save')}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
```

- [ ] **Step 8: Verify frontend build**

```bash
cd /Users/wouterhermans/Developer/opencoop && pnpm --filter web build
```

Expected: Build succeeds.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/app/[locale]/dashboard/shares/page.tsx
git commit -m "feat: add minor shareholder sections with buy/sell/edit to shares page"
```

---

### Task 8: Frontend — Include minor shares in dashboard stats

**Files:**
- Modify: `apps/web/src/app/[locale]/dashboard/page.tsx:46-92`

- [ ] **Step 1: Update the profile type to include minorShareholders**

In `dashboard/page.tsx`, update the `api<...>` type (line 49-56) to include `minorShareholders`:

```typescript
        const profile = await api<{
          shareholderCoops: Array<{ id: string }>;
          shareholders: Array<{
            id: string;
            coop?: { name?: string };
            registrations: Array<{ sharesOwned: number; quantity: number; pricePerShare: number; status: string }>;
          }>;
          minorShareholders?: Array<{
            id: string;
            registrations: Array<{ sharesOwned: number; quantity: number; pricePerShare: number; status: string }>;
          }>;
        }>('/auth/me');
```

- [ ] **Step 2: Sum minor shareholders into the stats**

After the existing shareholder loop (after line 76, before `setStats`), add:

```typescript
          // Include minor shareholders in totals
          if (profile.minorShareholders) {
            for (const sh of profile.minorShareholders) {
              if (sh.registrations) {
                for (const reg of sh.registrations) {
                  if (reg.status === 'ACTIVE' || reg.status === 'COMPLETED') {
                    const qty = reg.sharesOwned ?? reg.quantity;
                    totalShares += qty;
                    totalValue += qty * Number(reg.pricePerShare);
                  }
                }
              }
            }
          }
```

- [ ] **Step 3: Verify build**

```bash
cd /Users/wouterhermans/Developer/opencoop && pnpm --filter web build
```

Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/[locale]/dashboard/page.tsx
git commit -m "feat: include minor shareholder shares in dashboard overview stats"
```

---

### Task 9: Full build verification

**Files:** None

- [ ] **Step 1: Run full monorepo build**

```bash
cd /Users/wouterhermans/Developer/opencoop && pnpm build
```

Expected: All packages build successfully.

- [ ] **Step 2: Start dev servers and manually verify**

```bash
cd /Users/wouterhermans/Developer/opencoop && pnpm dev
```

Manual verification checklist:
1. Log in as a shareholder with registered minors
2. Check the shares page shows minor sections below parent's shares
3. Click the edit pencil on a minor to open profile dialog
4. Verify buy button works for a minor
5. Check the dashboard overview sums include minors
6. Test admin preview mode shows minors

- [ ] **Step 3: Commit any fixes if needed**

---

### Task 10: Final cleanup and push

**Files:** None

- [ ] **Step 1: Review all changes**

```bash
cd /Users/wouterhermans/Developer/opencoop && git log --oneline feature/minor-shareholder-visibility ^main
```

- [ ] **Step 2: Push feature branch**

```bash
git push -u origin feature/minor-shareholder-visibility
```
