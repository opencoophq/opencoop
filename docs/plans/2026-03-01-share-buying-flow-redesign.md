# Share Buying Flow Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let members self-initiate share purchases (seeing a QR code immediately), with optional admin approval gated by `requiresApproval`, and auto-complete on bank import match.

**Architecture:** Add `AWAITING_PAYMENT` to `TransactionStatus` and `ShareStatus` enums. Branch initial status based on `coop.requiresApproval`. Modify `approve()` to transition to AWAITING_PAYMENT instead of ACTIVE. Add auto-completion logic in bank import service. Add member self-service purchase endpoint and frontend buy dialog.

**Tech Stack:** Prisma (schema + migration), NestJS (service + controller), Next.js (React pages), next-intl (i18n)

---

### Task 1: Add AWAITING_PAYMENT to Prisma enums + migrate

**Files:**
- Modify: `packages/database/prisma/schema.prisma:32-37` (ShareStatus enum)
- Modify: `packages/database/prisma/schema.prisma:46-51` (TransactionStatus enum)

**Step 1: Add AWAITING_PAYMENT to both enums**

In `schema.prisma`, change:

```prisma
enum ShareStatus {
  PENDING
  AWAITING_PAYMENT
  ACTIVE
  SOLD
  TRANSFERRED
}

enum TransactionStatus {
  PENDING
  AWAITING_PAYMENT
  APPROVED
  COMPLETED
  REJECTED
}
```

Note: Keep `APPROVED` for backwards compatibility with existing data.

**Step 2: Create migration**

Run: `pnpm db:migrate --name add_awaiting_payment_status`

**Step 3: Generate Prisma client**

Run: `pnpm db:generate`

**Step 4: Verify build**

Run: `cd apps/api && pnpm build`
Expected: Build succeeds with no type errors.

**Step 5: Commit**

```bash
git add packages/database/prisma/
git commit -m "feat: add AWAITING_PAYMENT to ShareStatus and TransactionStatus enums"
```

---

### Task 2: Modify `createPurchase()` to branch on `requiresApproval`

**Files:**
- Modify: `apps/api/src/modules/transactions/transactions.service.ts:92-196`

**Step 1: Update `createPurchase` to accept and use `requiresApproval`**

In `transactions.service.ts`, change the `createPurchase` method. After fetching the coop for OGM code (line 128), also fetch `requiresApproval`:

```typescript
const coop = await this.prisma.coop.findUnique({
  where: { id: data.coopId },
  select: { ogmPrefix: true, requiresApproval: true },
});
```

Then use it when creating the share and transaction (lines 140-165):

```typescript
const initialStatus = coop!.requiresApproval ? 'PENDING' : 'AWAITING_PAYMENT';

// Create share
const share = await tx.share.create({
  data: {
    coopId: data.coopId,
    shareholderId: data.shareholderId,
    shareClassId: data.shareClassId,
    projectId: data.projectId || null,
    quantity: data.quantity,
    purchasePricePerShare: pricePerShare,
    purchaseDate: new Date(),
    status: initialStatus,
  },
});

// Create transaction
const transaction = await tx.transaction.create({
  data: {
    coopId: data.coopId,
    type: 'PURCHASE',
    status: initialStatus,
    shareholderId: data.shareholderId,
    shareId: share.id,
    quantity: data.quantity,
    pricePerShare,
    totalAmount,
  },
});
```

**Step 2: Verify build**

Run: `cd apps/api && pnpm build`

**Step 3: Commit**

```bash
git add apps/api/src/modules/transactions/transactions.service.ts
git commit -m "feat: branch purchase initial status on requiresApproval"
```

---

### Task 3: Modify `approve()` to transition to AWAITING_PAYMENT

**Files:**
- Modify: `apps/api/src/modules/transactions/transactions.service.ts:268-317`

**Step 1: Update `approve()` method**

Change the approve method so that for purchases, it transitions to `AWAITING_PAYMENT` instead of `ACTIVE`:

```typescript
async approve(id: string, processedByUserId: string) {
  const transaction = await this.findById(id);

  if (transaction.status !== 'PENDING') {
    throw new BadRequestException('Only pending transactions can be approved');
  }

  return this.prisma.$transaction(async (tx) => {
    const updated = await tx.transaction.update({
      where: { id },
      data: {
        status: transaction.type === 'PURCHASE' ? 'AWAITING_PAYMENT' : 'APPROVED',
        processedByUserId,
        processedAt: new Date(),
      },
    });

    if (transaction.type === 'SALE' && transaction.shareId) {
      // For sales: check if full quantity is being sold
      const share = await tx.share.findUnique({ where: { id: transaction.shareId } });
      if (share) {
        const allApprovedSells = await tx.transaction.aggregate({
          where: {
            shareId: transaction.shareId,
            type: 'SALE',
            status: 'APPROVED',
          },
          _sum: { quantity: true },
        });

        const totalApproved = allApprovedSells._sum.quantity || 0;
        if (totalApproved >= share.quantity) {
          await tx.share.update({
            where: { id: transaction.shareId },
            data: { status: 'SOLD' },
          });
        }
      }
    } else if (transaction.type === 'PURCHASE' && transaction.shareId) {
      // For purchases: move share to AWAITING_PAYMENT (not ACTIVE yet)
      await tx.share.update({
        where: { id: transaction.shareId },
        data: { status: 'AWAITING_PAYMENT' },
      });
    }

    return updated;
  });
}
```

**Step 2: Verify build**

Run: `cd apps/api && pnpm build`

**Step 3: Commit**

```bash
git add apps/api/src/modules/transactions/transactions.service.ts
git commit -m "feat: approve() transitions purchases to AWAITING_PAYMENT"
```

---

### Task 4: Modify `complete()` to accept AWAITING_PAYMENT and activate shares

**Files:**
- Modify: `apps/api/src/modules/transactions/transactions.service.ts:319-346`

**Step 1: Update `complete()` to accept AWAITING_PAYMENT**

```typescript
async complete(id: string, processedByUserId: string) {
  const transaction = await this.findById(id);

  if (transaction.status !== 'APPROVED' && transaction.status !== 'AWAITING_PAYMENT') {
    throw new BadRequestException('Only approved or awaiting payment transactions can be completed');
  }

  return this.prisma.$transaction(async (tx) => {
    const updated = await tx.transaction.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        processedByUserId,
        processedAt: new Date(),
      },
    });

    // Activate share for purchases
    if (transaction.type === 'PURCHASE' && transaction.shareId) {
      await tx.share.update({
        where: { id: transaction.shareId },
        data: { status: 'ACTIVE' },
      });
    }

    // Mark payment as confirmed
    if (transaction.payment) {
      await tx.payment.update({
        where: { id: transaction.payment.id },
        data: { status: 'CONFIRMED' },
      });
    }

    return updated;
  });
}
```

**Step 2: Verify build**

Run: `cd apps/api && pnpm build`

**Step 3: Commit**

```bash
git add apps/api/src/modules/transactions/transactions.service.ts
git commit -m "feat: complete() accepts AWAITING_PAYMENT and activates purchase shares"
```

---

### Task 5: Auto-complete transactions on bank import match

**Files:**
- Modify: `apps/api/src/modules/bank-import/bank-import.service.ts:85-106`

**Step 1: Inject TransactionsService**

Add `TransactionsService` to the constructor:

```typescript
import { TransactionsService } from '../transactions/transactions.service';

@Injectable()
export class BankImportService {
  constructor(
    private prisma: PrismaService,
    private transactionsService: TransactionsService,
  ) {}
```

Make sure `TransactionsModule` is imported in `BankImportModule`.

**Step 2: Auto-complete on match**

In `importBelfiusCsv`, after updating payment status to `MATCHED` (line 97-100), add auto-completion:

```typescript
if (payment && payment.coopId === coopId && payment.status === 'PENDING') {
  matchedPaymentId = payment.id;
  matchStatus = 'AUTO_MATCHED';
  matchedCount++;

  // Update payment status
  await this.prisma.payment.update({
    where: { id: payment.id },
    data: { status: 'MATCHED' },
  });

  // Auto-complete the transaction
  const paymentWithTx = await this.prisma.payment.findUnique({
    where: { id: payment.id },
    select: { transaction: { select: { id: true, status: true } } },
  });
  if (
    paymentWithTx?.transaction &&
    (paymentWithTx.transaction.status === 'AWAITING_PAYMENT' ||
     paymentWithTx.transaction.status === 'APPROVED')
  ) {
    await this.transactionsService.complete(
      paymentWithTx.transaction.id,
      importedById,
    );
  }
}
```

**Step 3: Update BankImportModule imports**

In `apps/api/src/modules/bank-import/bank-import.module.ts`, import `TransactionsModule`:

```typescript
imports: [TransactionsModule],
```

**Step 4: Verify build**

Run: `cd apps/api && pnpm build`

**Step 5: Commit**

```bash
git add apps/api/src/modules/bank-import/
git commit -m "feat: auto-complete transactions on bank import OGM match"
```

---

### Task 6: Add member self-service purchase endpoint

**Files:**
- Modify: `apps/api/src/modules/shareholders/shareholder-actions.controller.ts`

**Step 1: Add PurchaseRequestDto and endpoint**

Add a new DTO class alongside the existing `SellRequestDto` (after line 35):

```typescript
class PurchaseRequestDto {
  @IsString()
  shareClassId: string;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsOptional()
  @IsString()
  projectId?: string;
}
```

Add the purchase endpoint in the controller class (after the `sellRequest` method, around line 186):

```typescript
@Post('purchase')
@ApiOperation({ summary: 'Purchase shares (shareholder self-service)' })
async purchaseRequest(
  @Param('shareholderId') shareholderId: string,
  @CurrentUser() user: CurrentUserData,
  @Body() dto: PurchaseRequestDto,
) {
  const shareholder = await this.verifyShareholder(shareholderId, user.id);

  const transaction = await this.transactionsService.createPurchase({
    coopId: shareholder.coopId,
    shareholderId,
    shareClassId: dto.shareClassId,
    quantity: dto.quantity,
    projectId: dto.projectId,
  });

  // Return payment details so frontend can show QR code
  if (transaction) {
    const paymentDetails = await this.transactionsService.getPaymentDetails(
      transaction.id,
      shareholder.coopId,
    );
    return {
      transaction,
      paymentDetails,
    };
  }

  return { transaction };
}
```

**Step 2: Verify build**

Run: `cd apps/api && pnpm build`

**Step 3: Commit**

```bash
git add apps/api/src/modules/shareholders/shareholder-actions.controller.ts
git commit -m "feat: add member self-service purchase endpoint"
```

---

### Task 7: Update `createSale` pending sell check to include AWAITING_PAYMENT

**Files:**
- Modify: `apps/api/src/modules/transactions/transactions.service.ts:218-225`

**Step 1: Include AWAITING_PAYMENT in pending sells query**

Update the status filter in `createSale` (line 222):

```typescript
const pendingSells = await this.prisma.transaction.aggregate({
  where: {
    shareId: data.shareId,
    type: 'SALE',
    status: { in: ['PENDING', 'APPROVED', 'AWAITING_PAYMENT'] },
  },
  _sum: { quantity: true },
});
```

**Step 2: Verify build**

Run: `cd apps/api && pnpm build`

**Step 3: Commit**

```bash
git add apps/api/src/modules/transactions/transactions.service.ts
git commit -m "fix: include AWAITING_PAYMENT in pending sell quantity check"
```

---

### Task 8: Add i18n keys for AWAITING_PAYMENT status

**Files:**
- Modify: `apps/web/messages/en.json`
- Modify: `apps/web/messages/nl.json`
- Modify: `apps/web/messages/fr.json`
- Modify: `apps/web/messages/de.json`

**Step 1: Add translation keys**

In each locale file, add `AWAITING_PAYMENT` to `transactions.statuses` (after `PENDING`):

**en.json:**
```json
"statuses": {
  "PENDING": "Pending",
  "AWAITING_PAYMENT": "Awaiting Payment",
  "APPROVED": "Approved",
  "COMPLETED": "Completed",
  "REJECTED": "Rejected"
}
```

Also add to `shareholders.statuses` for share status badges:

Search for the share status translations and add `AWAITING_PAYMENT` there too. Check if shares use `shareholders.statuses` or inline status display.

**nl.json:** `"AWAITING_PAYMENT": "Wacht op betaling"`
**fr.json:** `"AWAITING_PAYMENT": "En attente de paiement"`
**de.json:** `"AWAITING_PAYMENT": "Zahlung ausstehend"`

Also add a new key for the "Buy Shares" button:
- en: `"shares.buyShares": "Buy Shares"`, `"shares.buySharesTitle": "Buy Shares"`, `"shares.selectShareClass": "Select share class"`, `"shares.totalCost": "Total cost"`, `"shares.awaitingPayment": "Awaiting payment"`, `"shares.purchaseSubmitted": "Purchase submitted successfully"`, `"shares.scanToPayMessage": "Scan the QR code with your banking app to pay"`
- nl: corresponding Dutch translations
- fr: corresponding French translations
- de: corresponding German translations

**Step 2: Commit**

```bash
git add apps/web/messages/
git commit -m "feat: add i18n keys for AWAITING_PAYMENT status and buy shares UI"
```

---

### Task 9: Update admin transactions page for new statuses

**Files:**
- Modify: `apps/web/src/app/[locale]/dashboard/admin/transactions/page.tsx`

**Step 1: Add AWAITING_PAYMENT to status filter dropdown (line 183-188)**

Add after the PENDING SelectItem:

```tsx
<SelectItem value="AWAITING_PAYMENT">{t('transactions.statuses.AWAITING_PAYMENT')}</SelectItem>
```

**Step 2: Update status badge styling (lines 224-233)**

Add AWAITING_PAYMENT badge variant:

```tsx
variant={
  tx.status === 'COMPLETED'
    ? 'default'
    : tx.status === 'PENDING'
      ? 'secondary'
      : tx.status === 'REJECTED'
        ? 'destructive'
        : tx.status === 'AWAITING_PAYMENT'
          ? 'outline'
          : 'outline'
}
```

**Step 3: Update `canShowPayment` to include AWAITING_PAYMENT (line 164-168)**

```tsx
const canShowPayment = (tx: TransactionRow) => {
  if (tx.type === 'PURCHASE' && ['PENDING', 'AWAITING_PAYMENT', 'APPROVED'].includes(tx.status)) return true;
  if (tx.type === 'SALE' && tx.status === 'APPROVED') return true;
  return false;
};
```

**Step 4: Update "Complete" button to show for AWAITING_PAYMENT (line 329)**

Change from `paymentTxStatus === 'APPROVED'` to:

```tsx
{(paymentTxStatus === 'APPROVED' || paymentTxStatus === 'AWAITING_PAYMENT') && (
  <Button onClick={handleComplete} disabled={completing}>
    {completing ? t('common.loading') : t('admin.transactions.markComplete')}
  </Button>
)}
```

**Step 5: Verify dev server**

Run: `cd apps/web && pnpm build`

**Step 6: Commit**

```bash
git add apps/web/src/app/[locale]/dashboard/admin/transactions/page.tsx
git commit -m "feat: update admin transactions page for AWAITING_PAYMENT status"
```

---

### Task 10: Add "Buy Shares" dialog to member shares page

**Files:**
- Modify: `apps/web/src/app/[locale]/dashboard/shares/page.tsx`

**Step 1: Add state and data fetching for buy dialog**

Add new state variables (after line 62):

```tsx
// Buy dialog state
const [buyOpen, setBuyOpen] = useState(false);
const [shareClasses, setShareClasses] = useState<Array<{ id: string; name: string; code: string; pricePerShare: number; minShares: number; maxShares?: number }>>([]);
const [buyShareClassId, setBuyShareClassId] = useState('');
const [buyQuantity, setBuyQuantity] = useState(1);
const [buyLoading, setBuyLoading] = useState(false);
const [buySuccess, setBuySuccess] = useState(false);
const [buyError, setBuyError] = useState('');
const [buyPaymentDetails, setBuyPaymentDetails] = useState<{
  beneficiaryName: string; iban: string; bic: string; amount: number; ogmCode: string;
} | null>(null);

// Transactions for AWAITING_PAYMENT display
const [pendingTransactions, setPendingTransactions] = useState<Array<{
  id: string; status: string; totalAmount: number; payment?: { ogmCode?: string };
}>>([]);
```

Update the `loadShares` function to also fetch share classes and pending transactions:

```tsx
// After loading shareholder data, fetch share classes and transactions
if (sh.coop) {
  // Need coopId for share classes - get it from first share or from shareholder
}
const txResult = await api<{ id: string; status: string; totalAmount: number; payment?: { ogmCode?: string } }[]>(
  `/shareholders/${sh.id}/transactions`
);
// Filter for AWAITING_PAYMENT purchase transactions
setPendingTransactions((txResult || []).filter(
  (tx: { status: string }) => tx.status === 'AWAITING_PAYMENT'
));
```

Note: May need a new endpoint to get share classes for the member's coop, or include them in the `/auth/me` response. Check what data is available and add a minimal endpoint if needed.

**Step 2: Add buy handler**

```tsx
const handleBuy = async () => {
  if (!shareholder || !buyShareClassId) return;
  setBuyLoading(true);
  setBuyError('');
  try {
    const result = await api<{
      transaction: { id: string };
      paymentDetails?: { beneficiaryName: string; iban: string; bic: string; amount: number; ogmCode: string };
    }>(`/shareholders/${shareholder.id}/purchase`, {
      method: 'POST',
      body: { shareClassId: buyShareClassId, quantity: buyQuantity },
    });
    setBuySuccess(true);
    if (result.paymentDetails) {
      setBuyPaymentDetails(result.paymentDetails);
    }
    // Reload shares
    const profile = await api<{ shareholders: ShareholderData[] }>('/auth/me');
    if (profile.shareholders?.[0]) {
      const sh = profile.shareholders[0];
      setShareholder(sh);
      setShares(sh.shares || []);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : t('common.error');
    setBuyError(message);
  } finally {
    setBuyLoading(false);
  }
};
```

**Step 3: Add "Buy Shares" button to page header**

Add a button next to or below the card title (around line 164):

```tsx
<CardHeader className="flex flex-row items-center justify-between">
  <CardTitle>{t('shares.myShares')}</CardTitle>
  <Button onClick={() => { setBuyOpen(true); setBuySuccess(false); setBuyError(''); setBuyPaymentDetails(null); }}>
    {t('shares.buyShares')}
  </Button>
</CardHeader>
```

**Step 4: Add Buy dialog JSX**

After the Sell Shares Dialog (around line 338), add:

```tsx
{/* Buy Shares Dialog */}
<Dialog open={buyOpen} onOpenChange={setBuyOpen}>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>{t('shares.buySharesTitle')}</DialogTitle>
    </DialogHeader>
    {buySuccess && buyPaymentDetails ? (
      <div className="space-y-4">
        <Alert>
          <AlertDescription>{t('shares.purchaseSubmitted')}</AlertDescription>
        </Alert>
        <div className="flex justify-center">
          <EpcQrCode
            bic={buyPaymentDetails.bic}
            beneficiaryName={buyPaymentDetails.beneficiaryName}
            iban={buyPaymentDetails.iban}
            amount={buyPaymentDetails.amount}
            reference={buyPaymentDetails.ogmCode}
          />
        </div>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t('payments.beneficiary')}</span>
            <span className="font-medium">{buyPaymentDetails.beneficiaryName}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t('payments.iban')}</span>
            <span className="font-mono text-xs">{formatIban(buyPaymentDetails.iban)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t('common.amount')}</span>
            <span className="font-medium">{formatCurrency(buyPaymentDetails.amount, locale)}</span>
          </div>
          {buyPaymentDetails.ogmCode && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('payments.ogmCode')}</span>
              <span className="font-mono text-xs">{buyPaymentDetails.ogmCode}</span>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={() => setBuyOpen(false)}>{t('common.confirm')}</Button>
        </DialogFooter>
      </div>
    ) : (
      <div className="space-y-4">
        {buyError && (
          <Alert variant="destructive">
            <AlertDescription>{buyError}</AlertDescription>
          </Alert>
        )}
        <div className="space-y-2">
          <Label>{t('shares.selectShareClass')}</Label>
          <Select value={buyShareClassId} onValueChange={setBuyShareClassId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {shareClasses.map((sc) => (
                <SelectItem key={sc.id} value={sc.id}>
                  {sc.name} — {formatCurrency(Number(sc.pricePerShare), locale)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>{t('shares.quantity')}</Label>
          <Input
            type="number"
            min={1}
            value={buyQuantity}
            onChange={(e) => setBuyQuantity(Math.max(1, parseInt(e.target.value) || 1))}
          />
        </div>
        {buyShareClassId && (
          <div className="border-t pt-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{t('shares.totalCost')}</span>
              <span className="font-bold">
                {formatCurrency(
                  buyQuantity * Number(shareClasses.find((sc) => sc.id === buyShareClassId)?.pricePerShare || 0),
                  locale,
                )}
              </span>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setBuyOpen(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleBuy} disabled={buyLoading || !buyShareClassId}>
            {buyLoading ? t('common.loading') : t('shares.buyShares')}
          </Button>
        </DialogFooter>
      </div>
    )}
  </DialogContent>
</Dialog>
```

**Step 5: Add AWAITING_PAYMENT badge variant to `statusVariant` function (line 82-89)**

```tsx
const statusVariant = (status: string) => {
  switch (status) {
    case 'ACTIVE': return 'default' as const;
    case 'PENDING': return 'secondary' as const;
    case 'AWAITING_PAYMENT': return 'outline' as const;
    case 'SOLD': return 'destructive' as const;
    default: return 'outline' as const;
  }
};
```

**Step 6: Add necessary imports**

Add `EpcQrCode`, `Select` components, and any other missing imports at the top of the file.

**Step 7: Handle share class data loading**

Need to fetch share classes for the member's coop. Add to the `loadShares` effect — fetch from the coop's public info endpoint (which already exists):

```tsx
// After getting shareholder, fetch coop's share classes
if (sh.coopId || sh.coop) {
  // Use the coop slug or ID to fetch public info with share classes
}
```

This may require adding `coopId` and `coopSlug` to the shareholder data returned by `/auth/me`, or adding a new lightweight endpoint. Check what's available and add minimally.

**Step 8: Verify dev server**

Run: `cd apps/web && pnpm build`

**Step 9: Commit**

```bash
git add apps/web/src/app/[locale]/dashboard/shares/page.tsx
git commit -m "feat: add Buy Shares dialog to member shares page with QR code"
```

---

### Task 11: Update registration flow to show QR immediately

**Files:**
- Modify: `apps/web/src/components/coop-register-content.tsx`

**Step 1: Verify current behavior**

The registration flow already calls `POST /coops/:slug/register` which calls `transactionsService.createPurchase()`. Since Task 2 makes `createPurchase()` respect `requiresApproval`, the registration flow will already create transactions with the correct initial status.

The confirmation step (step 3) already shows the EPC QR code with OGM code. So this should work without code changes to the component.

**Step 2: Verify the backend `publicRegister` returns payment details**

Check `coops.service.ts:417-429`. It already returns `ogmCode` from the transaction. The frontend already displays this with an EPC QR code on step 3.

**Step 3: No code changes needed — verify the flow works end-to-end**

The registration flow should now automatically create AWAITING_PAYMENT transactions for coops without approval. Verify manually.

**Step 4: Commit (if any minor adjustments needed)**

```bash
git commit -m "verify: registration flow works with new status model"
```

---

### Task 12: Update `getPaymentDetails` and `canShowPayment` for new flow

**Files:**
- Modify: `apps/api/src/modules/transactions/transactions.service.ts:348-404` (getPaymentDetails)

**Step 1: Verify `getPaymentDetails` works for AWAITING_PAYMENT**

The current `getPaymentDetails` method doesn't filter by status — it works for any transaction. No changes needed to the backend method.

**Step 2: Update member shares page to show payment info for AWAITING_PAYMENT shares**

In the shares table (Task 10), add a column or inline display showing "Pay now" with QR code link for AWAITING_PAYMENT shares. This was partially covered in Task 10 — ensure the table shows a payment action for AWAITING_PAYMENT status shares.

Add to the actions column (around line 204-215 of the original file):

```tsx
{share.status === 'AWAITING_PAYMENT' && (
  <Button
    variant="ghost"
    size="sm"
    onClick={() => showPaymentForShare(share.id)}
  >
    <QrCode className="h-4 w-4 mr-1" />
    {t('shares.awaitingPayment')}
  </Button>
)}
```

This requires fetching payment details for the share's transaction. Add a handler:

```tsx
const showPaymentForShare = async (shareId: string) => {
  // Find the AWAITING_PAYMENT transaction for this share from loaded transactions
  // Show the QR code dialog
};
```

**Step 3: Commit**

```bash
git add apps/web/src/app/[locale]/dashboard/shares/page.tsx
git commit -m "feat: show payment QR code for AWAITING_PAYMENT shares on member dashboard"
```

---

### Task 13: Add endpoint for member to fetch their coop's share classes

**Files:**
- Modify: `apps/api/src/modules/shareholders/shareholder-actions.controller.ts`

**Step 1: Add endpoint**

```typescript
@Get('share-classes')
@ApiOperation({ summary: 'Get available share classes for purchasing' })
async getShareClasses(
  @Param('shareholderId') shareholderId: string,
  @CurrentUser() user: CurrentUserData,
) {
  const shareholder = await this.verifyShareholder(shareholderId, user.id);

  return this.prisma.shareClass.findMany({
    where: { coopId: shareholder.coopId, isActive: true },
    select: {
      id: true,
      name: true,
      code: true,
      pricePerShare: true,
      minShares: true,
      maxShares: true,
    },
  });
}
```

**Step 2: Verify build**

Run: `cd apps/api && pnpm build`

**Step 3: Commit**

```bash
git add apps/api/src/modules/shareholders/shareholder-actions.controller.ts
git commit -m "feat: add share-classes endpoint for member self-service"
```

---

### Task 14: Add endpoint for member to fetch their transactions

**Files:**
- Modify: `apps/api/src/modules/shareholders/shareholder-actions.controller.ts`

**Step 1: Add endpoint**

```typescript
@Get('transactions')
@ApiOperation({ summary: 'Get shareholder transactions' })
async getTransactions(
  @Param('shareholderId') shareholderId: string,
  @CurrentUser() user: CurrentUserData,
) {
  const shareholder = await this.verifyShareholder(shareholderId, user.id);
  return this.transactionsService.findByShareholder(shareholderId);
}
```

**Step 2: Verify build**

Run: `cd apps/api && pnpm build`

**Step 3: Commit**

```bash
git add apps/api/src/modules/shareholders/shareholder-actions.controller.ts
git commit -m "feat: add transactions endpoint for member self-service"
```

---

### Task 15: Final integration verification

**Step 1: Run full build**

Run: `pnpm build`
Expected: All packages build successfully.

**Step 2: Run tests**

Run: `cd apps/api && pnpm test`
Expected: All existing tests pass.

**Step 3: Manual verification checklist**

- [ ] New coop (requiresApproval=false): member buys shares → status AWAITING_PAYMENT → QR shown
- [ ] New coop (requiresApproval=true): member buys shares → status PENDING → admin approves → AWAITING_PAYMENT → QR shown
- [ ] Bank import with matching OGM → transaction auto-completed → share ACTIVE
- [ ] Admin can manually "Confirm Payment" for AWAITING_PAYMENT transactions
- [ ] Registration flow shows QR code on step 3
- [ ] Member dashboard shows "Buy Shares" button and payment QR for pending purchases
- [ ] Admin can reject PENDING transactions
- [ ] Existing APPROVED transactions in database still work

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete share buying flow redesign — member self-service with QR codes"
```
