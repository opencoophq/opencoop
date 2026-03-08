# Gift Certificate Feature — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete end-to-end gift share purchase: buyer buys gift shares, payment triggers gift code generation + PDF certificate email, recipient claims via `/claim` page, shares transfer from buyer to recipient.

**Architecture:** Add `isGift`, `giftCode`, `giftClaimedAt`, `giftClaimedByShareholderId` to the Registration model. Hook gift code generation into existing payment-completion paths. New public API endpoints for gift validation and claiming. New PDF template for gift certificate. Wire up existing claim page stub to real API.

**Tech Stack:** Prisma (schema), NestJS (API endpoints + rate limiting), @react-pdf/renderer (PDF), Bull queue (email), Next.js (claim page)

---

### Task 1: Schema — Add gift fields to Registration model

**Files:**
- Modify: `packages/database/prisma/schema.prisma`

**Step 1: Add gift fields to Registration model**

In `packages/database/prisma/schema.prisma`, find the `Registration` model (line ~484). Add these fields after the `ogmCode` field (line ~523):

```prisma
  // Gift certificate
  isGift                     Boolean    @default(false)
  giftCode                   String?    @unique
  giftClaimedAt              DateTime?
  giftClaimedByShareholderId String?
  giftClaimedByShareholder   Shareholder? @relation("GiftClaimedBy", fields: [giftClaimedByShareholderId], references: [id])
```

Then add the reverse relation on the `Shareholder` model (line ~325). Add after the existing relations (around line ~390):

```prisma
  claimedGifts     Registration[] @relation("GiftClaimedBy")
```

**Step 2: Generate Prisma client and push schema**

Run:
```bash
pnpm db:generate && pnpm db:push
```

Expected: Schema changes applied, Prisma client regenerated.

**Step 3: Commit**

```bash
git add packages/database/prisma/schema.prisma
git commit -m "feat: add gift certificate fields to Registration model"
```

---

### Task 2: API — Accept `isGift` in registration, generate gift codes on completion

**Files:**
- Modify: `apps/api/src/modules/coops/dto/public-register.dto.ts`
- Modify: `apps/api/src/modules/channels/channels.service.ts`
- Modify: `apps/api/src/modules/registrations/registrations.service.ts`
- Modify: `apps/api/src/modules/payments/payments.service.ts`
- Modify: `apps/api/src/modules/bank-import/bank-import.service.ts`

**Step 1: Add `isGift` to PublicRegisterDto**

In `apps/api/src/modules/coops/dto/public-register.dto.ts`, add after the `projectId` field (line ~90):

```typescript
  @ApiProperty({ required: false, description: 'Whether this is a gift purchase' })
  @IsOptional()
  @IsBoolean()
  isGift?: boolean;
```

Add `IsBoolean` to the imports from `class-validator`.

**Step 2: Pass `isGift` through ChannelsService.publicRegister()**

In `apps/api/src/modules/channels/channels.service.ts`, modify the `publicRegister` method.

Update the `createBuy` call (line ~457) to include `isGift`:

```typescript
    const registration = await this.registrationsService.createBuy({
      coopId: coop.id,
      shareholderId,
      shareClassId: dto.shareClassId,
      quantity: dto.quantity,
      projectId: dto.projectId,
      channelId: channel.id,
      isGift: dto.isGift,
    });
```

**Step 3: Accept `isGift` in RegistrationsService.createBuy()**

In `apps/api/src/modules/registrations/registrations.service.ts`, update the `createBuy` method signature (line ~158) to accept `isGift`:

```typescript
  async createBuy(data: {
    coopId: string;
    shareholderId: string;
    shareClassId: string;
    quantity: number;
    projectId?: string;
    isSavings?: boolean;
    channelId?: string;
    isGift?: boolean;
  }) {
```

And in the `tx.registration.create` data (line ~214), add:

```typescript
          isGift: data.isGift || false,
```

**Step 4: Add gift code generation helper to RegistrationsService**

Add this method to `RegistrationsService` (at the end of the class, before the closing `}`):

```typescript
  /**
   * Generate a unique gift code in format XXXX-XXXX.
   * Uses 32-char alphabet (A-Z, 2-9, excluding ambiguous 0/O/I/1/L).
   */
  private async generateGiftCode(): Promise<string> {
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    const maxAttempts = 10;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      let code = '';
      for (let i = 0; i < 8; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
      }
      code = code.slice(0, 4) + '-' + code.slice(4);

      // Check uniqueness
      const existing = await this.prisma.registration.findUnique({
        where: { giftCode: code },
      });
      if (!existing) return code;
    }

    throw new Error('Failed to generate unique gift code after 10 attempts');
  }

  /**
   * Called after a registration transitions to COMPLETED.
   * If it's a gift registration, generates a gift code.
   * Returns the generated gift code or null.
   */
  async onRegistrationCompleted(registrationId: string): Promise<string | null> {
    const registration = await this.prisma.registration.findUnique({
      where: { id: registrationId },
    });

    if (!registration || !registration.isGift || registration.giftCode) {
      return null; // Not a gift, or already has a code
    }

    const giftCode = await this.generateGiftCode();

    await this.prisma.registration.update({
      where: { id: registrationId },
      data: { giftCode },
    });

    return giftCode;
  }
```

**Step 5: Hook into PaymentsService.addPayment()**

In `apps/api/src/modules/payments/payments.service.ts`:

1. Add `RegistrationsService` as a dependency. Update the constructor:

```typescript
  constructor(
    private prisma: PrismaService,
    private registrationsService: RegistrationsService,
  ) {}
```

2. Add import at top:
```typescript
import { RegistrationsService } from '../registrations/registrations.service';
```

3. After the `status: 'COMPLETED'` update (line ~76), call the hook:

```typescript
    if (totalPaid >= totalAmount) {
      await this.prisma.registration.update({
        where: { id: data.registrationId },
        data: { status: 'COMPLETED' },
      });

      // Gift code generation (fire-and-forget for now)
      await this.registrationsService.onRegistrationCompleted(data.registrationId);
    }
```

4. Update `PaymentsModule` to import `RegistrationsModule`. In `apps/api/src/modules/payments/payments.module.ts`, add:

```typescript
import { RegistrationsModule } from '../registrations/registrations.module';

@Module({
  imports: [RegistrationsModule],
  // ...
})
```

**Step 6: Hook into BankImportService**

In `apps/api/src/modules/bank-import/bank-import.service.ts`:

After the `status: 'COMPLETED'` update inside `importBelfiusCsv` transaction (line ~166), add outside the transaction (after line ~176, after `continue`):

Actually, the bank import uses `$transaction` and we can't call `onRegistrationCompleted` inside because it does its own DB calls. Instead, collect completed registration IDs and process after:

Before the `for` loop (line ~72), add:
```typescript
    const completedGiftRegistrationIds: string[] = [];
```

After the `status: 'COMPLETED'` update (line ~166), add inside the transaction:
```typescript
              if (registration.isGift) {
                completedGiftRegistrationIds.push(registration.id);
              }
```

Wait — `registration` here doesn't include `isGift` yet. We need to include it in the query. The registration is fetched at line ~116:
```typescript
        const registration = await this.prisma.registration.findUnique({
          where: { ogmCode },
        });
```

This already fetches all scalar fields including `isGift` (Prisma returns all scalars by default), so `registration.isGift` will work.

After the `for` loop ends (before the `return` at line ~201), add:
```typescript
    // Generate gift codes for completed gift registrations
    for (const regId of completedGiftRegistrationIds) {
      await this.registrationsService.onRegistrationCompleted(regId);
    }
```

Do the same for `manualMatch` (line ~207). After the transaction completes (after line ~274 `return { success: true }`):

Actually, `manualMatch` returns inside the transaction. Restructure: capture the registration ID and check after. Replace the end of `manualMatch`:

After the transaction block, but before the method ends, we need to restructure slightly. The current code returns `{ success: true }` from within the `$transaction`. Change the end of the method to:

```typescript
    const result = await this.prisma.$transaction(async (tx) => {
      // ... existing code ...
      return { success: true, registrationId, isCompleted: totalPaid >= Number(registration.totalAmount) };
    });

    // Generate gift code if completed and is gift
    if (result.isCompleted) {
      await this.registrationsService.onRegistrationCompleted(registrationId);
    }

    return { success: true };
```

Note: `registrationId` is already a parameter.

Also hook into `RegistrationsService.complete()` (line ~311). After the `$transaction` that sets status to COMPLETED (line ~349), add:

```typescript
    const result = await this.prisma.$transaction(async (tx) => {
      // ... existing code ...
    });

    // Generate gift code if this is a gift registration
    await this.onRegistrationCompleted(id);

    return result;
```

**Step 7: Commit**

```bash
git add apps/api/src/modules/coops/dto/public-register.dto.ts \
        apps/api/src/modules/channels/channels.service.ts \
        apps/api/src/modules/registrations/registrations.service.ts \
        apps/api/src/modules/payments/payments.service.ts \
        apps/api/src/modules/payments/payments.module.ts \
        apps/api/src/modules/bank-import/bank-import.service.ts
git commit -m "feat: accept isGift flag and generate gift codes on payment completion"
```

---

### Task 3: API — Gift validation and claim endpoints

**Files:**
- Create: `apps/api/src/modules/channels/dto/claim-gift.dto.ts`
- Modify: `apps/api/src/modules/channels/channels.controller.ts`
- Modify: `apps/api/src/modules/channels/channels.service.ts`

**Step 1: Create ClaimGiftDto**

Create `apps/api/src/modules/channels/dto/claim-gift.dto.ts`:

```typescript
import {
  IsString,
  IsEmail,
  IsOptional,
  IsDateString,
  ValidateNested,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { AddressDto } from '../../shareholders/dto/create-shareholder.dto';

export class ClaimGiftDto {
  @ApiProperty({ description: 'Gift code (format: XXXX-XXXX)' })
  @IsString()
  giftCode: string;

  @ApiProperty()
  @IsString()
  firstName: string;

  @ApiProperty()
  @IsString()
  lastName: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  birthDate?: string;

  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiProperty({ required: false, type: AddressDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => AddressDto)
  address?: AddressDto;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  nationalId?: string;
}
```

**Step 2: Add validate and claim endpoints to ChannelsController**

In `apps/api/src/modules/channels/channels.controller.ts`, add imports:

```typescript
import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ClaimGiftDto } from './dto/claim-gift.dto';
```

Add two new endpoints after the existing `register` endpoint:

```typescript
  @Public()
  @Get(':channelSlug/gift/:code/validate')
  @Throttle({ default: { ttl: 900000, limit: 5 } })
  @ApiOperation({ summary: 'Validate a gift code' })
  @ApiResponse({ status: 200, description: 'Gift code validation result' })
  async validateGiftCode(
    @Param('slug') slug: string,
    @Param('channelSlug') channelSlug: string,
    @Param('code') code: string,
  ) {
    return this.channelsService.validateGiftCode(slug, channelSlug, code);
  }

  @Public()
  @Post(':channelSlug/claim')
  @Throttle({ default: { ttl: 900000, limit: 5 } })
  @ApiOperation({ summary: 'Claim a gift certificate' })
  @ApiResponse({ status: 201, description: 'Gift claimed successfully' })
  async claimGift(
    @Param('slug') slug: string,
    @Param('channelSlug') channelSlug: string,
    @Body() dto: ClaimGiftDto,
  ) {
    return this.channelsService.claimGift(slug, channelSlug, dto);
  }
```

**Step 3: Implement validateGiftCode in ChannelsService**

In `apps/api/src/modules/channels/channels.service.ts`, add:

```typescript
  async validateGiftCode(coopSlug: string, channelSlug: string, code: string) {
    const coop = await this.prisma.coop.findUnique({
      where: { slug: coopSlug },
    });

    if (!coop) {
      return { valid: false };
    }

    const registration = await this.prisma.registration.findUnique({
      where: { giftCode: code },
      include: { shareClass: true },
    });

    if (
      !registration ||
      registration.coopId !== coop.id ||
      registration.status !== 'COMPLETED' ||
      !registration.isGift ||
      registration.giftClaimedAt
    ) {
      return { valid: false };
    }

    return {
      valid: true,
      coopName: coop.name,
      shareClassName: registration.shareClass.name,
      quantity: registration.quantity,
      totalValue: Number(registration.totalAmount),
    };
  }
```

**Step 4: Implement claimGift in ChannelsService**

Add to `ChannelsService`:

```typescript
  async claimGift(coopSlug: string, channelSlug: string, dto: ClaimGiftDto) {
    const coop = await this.prisma.coop.findUnique({
      where: { slug: coopSlug },
    });

    if (!coop) {
      throw new NotFoundException('Cooperative not found');
    }

    // Find and validate the gift registration
    const registration = await this.prisma.registration.findUnique({
      where: { giftCode: dto.giftCode },
      include: { shareClass: true },
    });

    if (
      !registration ||
      registration.coopId !== coop.id ||
      registration.status !== 'COMPLETED' ||
      !registration.isGift ||
      registration.giftClaimedAt
    ) {
      throw new BadRequestException('Invalid or already claimed gift code');
    }

    // Create recipient shareholder
    const recipientShareholder = await this.shareholdersService.create(coop.id, {
      type: 'INDIVIDUAL',
      firstName: dto.firstName,
      lastName: dto.lastName,
      birthDate: dto.birthDate,
      email: dto.email,
      phone: dto.phone,
      address: dto.address,
    });

    // Transfer shares: buyer → recipient
    await this.registrationsService.createTransfer({
      coopId: coop.id,
      fromShareholderId: registration.shareholderId,
      toShareholderId: recipientShareholder.id,
      registrationId: registration.id,
      quantity: registration.quantity,
      processedByUserId: registration.shareholderId, // system action, use buyer as actor
    });

    // Mark gift as claimed
    await this.prisma.registration.update({
      where: { id: registration.id },
      data: {
        giftClaimedAt: new Date(),
        giftClaimedByShareholderId: recipientShareholder.id,
      },
    });

    return {
      success: true,
      shareholderId: recipientShareholder.id,
    };
  }
```

**Step 5: Commit**

```bash
git add apps/api/src/modules/channels/dto/claim-gift.dto.ts \
        apps/api/src/modules/channels/channels.controller.ts \
        apps/api/src/modules/channels/channels.service.ts
git commit -m "feat: add gift code validation and claim endpoints"
```

---

### Task 4: PDF template — Gift certificate

**Files:**
- Create: `packages/pdf-templates/src/templates/gift-certificate.tsx`
- Modify: `packages/pdf-templates/src/index.ts`

**Step 1: Create gift certificate PDF template**

Create `packages/pdf-templates/src/templates/gift-certificate.tsx`:

```tsx
import React from 'react';
import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer';

export interface GiftCertificateProps {
  coopName: string;
  primaryColor: string;
  logoUrl?: string;
  shareClassName: string;
  quantity: number;
  totalValue: number;
  giftCode: string;
  claimUrl: string;
  qrCodeDataUrl: string; // base64 data URL of QR code
  locale: string;
}

const labels: Record<string, Record<string, string>> = {
  nl: {
    title: 'Cadeaubon',
    subtitle: 'Aandelenregistratie',
    shares: 'aandelen',
    shareClass: 'Aandelenklasse',
    quantity: 'Aantal',
    value: 'Waarde',
    code: 'Uw code',
    instructions: 'Scan de QR-code of ga naar onderstaande link om uw aandelen te claimen.',
    claimAt: 'Claim uw aandelen op:',
  },
  en: {
    title: 'Gift Certificate',
    subtitle: 'Share Registration',
    shares: 'shares',
    shareClass: 'Share Class',
    quantity: 'Quantity',
    value: 'Value',
    code: 'Your code',
    instructions: 'Scan the QR code or visit the link below to claim your shares.',
    claimAt: 'Claim your shares at:',
  },
  fr: {
    title: 'Chèque-cadeau',
    subtitle: 'Enregistrement de parts',
    shares: 'parts',
    shareClass: 'Classe de parts',
    quantity: 'Quantité',
    value: 'Valeur',
    code: 'Votre code',
    instructions: 'Scannez le code QR ou visitez le lien ci-dessous pour réclamer vos parts.',
    claimAt: 'Réclamez vos parts sur:',
  },
  de: {
    title: 'Geschenkgutschein',
    subtitle: 'Anteilsregistrierung',
    shares: 'Anteile',
    shareClass: 'Anteilsklasse',
    quantity: 'Anzahl',
    value: 'Wert',
    code: 'Ihr Code',
    instructions: 'Scannen Sie den QR-Code oder besuchen Sie den untenstehenden Link, um Ihre Anteile einzulösen.',
    claimAt: 'Lösen Sie Ihre Anteile ein unter:',
  },
};

export const GiftCertificate: React.FC<GiftCertificateProps> = (props) => {
  const l = labels[props.locale] || labels.nl;
  const color = props.primaryColor || '#1e40af';
  const formattedValue = `€ ${props.totalValue.toFixed(2)}`;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: color }]}>
          {props.logoUrl && (
            <Image src={props.logoUrl} style={styles.logo} />
          )}
          <Text style={[styles.coopName, { color }]}>{props.coopName}</Text>
          <Text style={styles.subtitle}>{l.subtitle}</Text>
        </View>

        {/* Title */}
        <View style={styles.titleSection}>
          <Text style={[styles.title, { color }]}>{l.title}</Text>
        </View>

        {/* Share details */}
        <View style={styles.detailsSection}>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>{l.shareClass}</Text>
            <Text style={styles.detailValue}>{props.shareClassName}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>{l.quantity}</Text>
            <Text style={styles.detailValue}>
              {props.quantity} {l.shares}
            </Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>{l.value}</Text>
            <Text style={[styles.detailValue, styles.valueHighlight, { color }]}>
              {formattedValue}
            </Text>
          </View>
        </View>

        {/* Gift code */}
        <View style={[styles.codeSection, { borderColor: color }]}>
          <Text style={styles.codeLabel}>{l.code}</Text>
          <Text style={[styles.codeValue, { color }]}>{props.giftCode}</Text>
        </View>

        {/* QR code */}
        <View style={styles.qrSection}>
          <Image src={props.qrCodeDataUrl} style={styles.qrCode} />
          <Text style={styles.instructions}>{l.instructions}</Text>
        </View>

        {/* Claim URL */}
        <View style={styles.claimUrlSection}>
          <Text style={styles.claimLabel}>{l.claimAt}</Text>
          <Text style={[styles.claimUrl, { color }]}>{props.claimUrl}</Text>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text>{props.coopName} — {l.title}</Text>
        </View>
      </Page>
    </Document>
  );
};

const styles = StyleSheet.create({
  page: {
    padding: 50,
    fontFamily: 'Helvetica',
    fontSize: 11,
  },
  header: {
    textAlign: 'center',
    marginBottom: 30,
    paddingBottom: 15,
    borderBottomWidth: 2,
    borderBottomStyle: 'solid',
  },
  logo: {
    height: 60,
    marginBottom: 10,
    objectFit: 'contain',
  },
  coopName: {
    fontSize: 20,
    fontFamily: 'Helvetica-Bold',
  },
  subtitle: {
    fontSize: 12,
    color: '#666666',
    marginTop: 4,
  },
  titleSection: {
    textAlign: 'center',
    marginBottom: 30,
  },
  title: {
    fontSize: 32,
    fontFamily: 'Helvetica-Bold',
  },
  detailsSection: {
    marginBottom: 30,
    padding: 20,
    backgroundColor: '#f8f9fa',
    borderRadius: 4,
  },
  detailRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  detailLabel: {
    width: '40%',
    color: '#555555',
    fontSize: 12,
  },
  detailValue: {
    width: '60%',
    fontSize: 12,
    fontFamily: 'Helvetica-Bold',
  },
  valueHighlight: {
    fontSize: 16,
  },
  codeSection: {
    textAlign: 'center',
    marginBottom: 30,
    padding: 20,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderRadius: 8,
  },
  codeLabel: {
    fontSize: 12,
    color: '#666666',
    marginBottom: 8,
  },
  codeValue: {
    fontSize: 28,
    fontFamily: 'Courier-Bold',
    letterSpacing: 3,
  },
  qrSection: {
    alignItems: 'center',
    marginBottom: 20,
  },
  qrCode: {
    width: 150,
    height: 150,
    marginBottom: 10,
  },
  instructions: {
    fontSize: 10,
    color: '#666666',
    textAlign: 'center',
  },
  claimUrlSection: {
    textAlign: 'center',
    marginBottom: 20,
  },
  claimLabel: {
    fontSize: 10,
    color: '#666666',
    marginBottom: 4,
  },
  claimUrl: {
    fontSize: 10,
    textDecoration: 'underline',
  },
  footer: {
    position: 'absolute',
    bottom: 40,
    left: 50,
    right: 50,
    textAlign: 'center',
    fontSize: 9,
    color: '#999999',
    borderTop: '1 solid #eeeeee',
    paddingTop: 10,
  },
});
```

**Step 2: Export from index**

In `packages/pdf-templates/src/index.ts`, add:

```typescript
export { GiftCertificate } from './templates/gift-certificate';
export type { GiftCertificateProps } from './templates/gift-certificate';
```

**Step 3: Commit**

```bash
git add packages/pdf-templates/src/templates/gift-certificate.tsx \
        packages/pdf-templates/src/index.ts
git commit -m "feat: add gift certificate PDF template"
```

---

### Task 5: Email — Send gift certificate PDF to buyer on payment completion

**Files:**
- Modify: `apps/api/src/modules/email/email.service.ts`
- Modify: `apps/api/src/modules/email/email.processor.ts`
- Modify: `apps/api/src/modules/registrations/registrations.service.ts`
- Modify: `apps/api/src/modules/documents/documents.service.ts`

**Step 1: Add gift certificate email method to EmailService**

In `apps/api/src/modules/email/email.service.ts`, add:

```typescript
  async sendGiftCertificate(
    coopId: string,
    to: string,
    data: {
      buyerName: string;
      coopName: string;
      shareClassName: string;
      quantity: number;
      totalValue: number;
      giftCode: string;
      certificatePath: string;
    },
  ) {
    return this.send({
      coopId,
      to,
      subject: `${data.coopName} — Your gift certificate`,
      templateKey: 'gift-certificate',
      templateData: data,
      attachments: [{ filename: 'gift-certificate.pdf', path: data.certificatePath }],
    });
  }
```

**Step 2: Add gift-certificate email template to EmailProcessor**

In `apps/api/src/modules/email/email.processor.ts`, add to the `templates` object in `renderTemplate` (after the `set-minor-email-reminder` template):

```typescript
      'gift-certificate': (d, cn) => `
        <h1>Your Gift Certificate</h1>
        <p>Dear ${d.buyerName},</p>
        <p>Thank you for purchasing a gift certificate at ${cn}!</p>
        <p>Your payment has been received and the gift certificate is attached to this email.</p>
        <ul>
          <li>Share Class: ${d.shareClassName}</li>
          <li>Quantity: ${d.quantity}</li>
          <li>Total Value: €${(d.totalValue as number).toFixed(2)}</li>
        </ul>
        <p>Gift code: <strong>${d.giftCode}</strong></p>
        <p>Share this certificate with the recipient. They can use the code or QR code to claim their shares.</p>
        <p>Thank you for being a shareholder of ${cn}!</p>
      `,
```

**Step 3: Add generateGiftCertificatePdf to DocumentsService**

In `apps/api/src/modules/documents/documents.service.ts`, add import:

```typescript
import { ShareCertificate, DividendStatement, GiftCertificate } from '@opencoop/pdf-templates';
```

Add method (use the `qrcode` npm package to generate QR code data URL — check if already in deps, otherwise add):

```typescript
  async generateGiftCertificatePdf(registrationId: string, locale?: string): Promise<string> {
    const registration = await this.prisma.registration.findUnique({
      where: { id: registrationId },
      include: {
        coop: true,
        shareClass: true,
        shareholder: true,
        channel: true,
      },
    });

    if (!registration || !registration.giftCode) {
      throw new NotFoundException('Gift registration not found');
    }

    const channelSlug = registration.channel?.slug || 'default';
    const domain = process.env.NEXT_PUBLIC_APP_URL || 'https://opencoop.be';
    const claimUrl = `${domain}/${registration.coop.slug}/${channelSlug}/claim?code=${registration.giftCode}`;

    // Generate QR code as data URL
    const QRCode = await import('qrcode');
    const qrCodeDataUrl = await QRCode.toDataURL(claimUrl, { width: 300 });

    const logoUrl = registration.channel?.logoUrl
      ? `${process.env.API_URL || 'http://localhost:3001'}${registration.channel.logoUrl}`
      : undefined;

    const element = React.createElement(GiftCertificate, {
      coopName: registration.coop.name,
      primaryColor: registration.channel?.primaryColor || '#1e40af',
      logoUrl,
      shareClassName: registration.shareClass.name,
      quantity: registration.quantity,
      totalValue: Number(registration.totalAmount),
      giftCode: registration.giftCode,
      claimUrl,
      qrCodeDataUrl,
      locale: locale || 'nl',
    });

    const buffer = await renderToBuffer(element as any);

    // Save to disk
    const dir = path.join(process.env.UPLOAD_DIR || './uploads', 'gift-certificates');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const filePath = path.join(dir, `${registrationId}.pdf`);
    fs.writeFileSync(filePath, buffer);

    return filePath;
  }
```

Note: check if `qrcode` package is installed: `pnpm list qrcode --filter api`. If not, run `pnpm add qrcode @types/qrcode --filter api`.

**Step 4: Wire up onRegistrationCompleted to generate PDF + send email**

In `apps/api/src/modules/registrations/registrations.service.ts`, the `onRegistrationCompleted` method needs access to `DocumentsService` and `EmailService`. This creates a circular dependency risk.

Better approach: create the PDF + email logic in `DocumentsService` and call it from `RegistrationsService` via event or direct injection.

Update `RegistrationsService` constructor to inject `DocumentsService` and `EmailService`:

```typescript
import { DocumentsService } from '../documents/documents.service';
import { EmailService } from '../email/email.service';

constructor(
  private prisma: PrismaService,
  private documentsService: DocumentsService,
  private emailService: EmailService,
) {}
```

Update `RegistrationsModule` to import `DocumentsModule` and `EmailModule`:
```typescript
imports: [forwardRef(() => DocumentsModule), EmailModule],
```

Update `onRegistrationCompleted` to generate PDF and send email:

```typescript
  async onRegistrationCompleted(registrationId: string): Promise<string | null> {
    const registration = await this.prisma.registration.findUnique({
      where: { id: registrationId },
      include: {
        shareholder: true,
        shareClass: true,
        coop: true,
      },
    });

    if (!registration || !registration.isGift || registration.giftCode) {
      return null;
    }

    const giftCode = await this.generateGiftCode();

    await this.prisma.registration.update({
      where: { id: registrationId },
      data: { giftCode },
    });

    // Generate PDF and send email
    try {
      const pdfPath = await this.documentsService.generateGiftCertificatePdf(registrationId);

      const buyerEmail = registration.shareholder.email;
      if (buyerEmail) {
        const buyerName = registration.shareholder.type === 'COMPANY'
          ? registration.shareholder.companyName || ''
          : `${registration.shareholder.firstName || ''} ${registration.shareholder.lastName || ''}`.trim();

        await this.emailService.sendGiftCertificate(registration.coopId, buyerEmail, {
          buyerName,
          coopName: registration.coop.name,
          shareClassName: registration.shareClass.name,
          quantity: registration.quantity,
          totalValue: Number(registration.totalAmount),
          giftCode,
          certificatePath: pdfPath,
        });
      }
    } catch (error) {
      // Log but don't fail — gift code is already saved
      console.error('Failed to generate/send gift certificate:', error);
    }

    return giftCode;
  }
```

**Step 5: Commit**

```bash
git add apps/api/src/modules/email/email.service.ts \
        apps/api/src/modules/email/email.processor.ts \
        apps/api/src/modules/registrations/registrations.service.ts \
        apps/api/src/modules/registrations/registrations.module.ts \
        apps/api/src/modules/documents/documents.service.ts
git commit -m "feat: generate gift certificate PDF and email to buyer on payment"
```

---

### Task 6: Frontend — Update registration form step 4 for gifts

**Files:**
- Modify: `apps/web/src/components/coop-register-content.tsx`
- Modify: `apps/web/messages/en.json`
- Modify: `apps/web/messages/nl.json`
- Modify: `apps/web/messages/fr.json`
- Modify: `apps/web/messages/de.json`

**Step 1: Add i18n keys**

In each locale file, add under the `registration` section:

**en.json:**
```json
"giftPaymentNote": "You'll receive the gift certificate by email once your payment clears.",
"giftSharesNote": "This is a gift of {quantity} {shareClassName} share(s) worth {totalValue}."
```

**nl.json:**
```json
"giftPaymentNote": "U ontvangt de cadeaubon per e-mail zodra uw betaling is verwerkt.",
"giftSharesNote": "Dit is een cadeau van {quantity} {shareClassName} aande(e)l(en) ter waarde van {totalValue}."
```

**fr.json:**
```json
"giftPaymentNote": "Vous recevrez le chèque-cadeau par e-mail dès que votre paiement sera traité.",
"giftSharesNote": "Ceci est un cadeau de {quantity} part(s) {shareClassName} d'une valeur de {totalValue}."
```

**de.json:**
```json
"giftPaymentNote": "Sie erhalten den Geschenkgutschein per E-Mail, sobald Ihre Zahlung eingegangen ist.",
"giftSharesNote": "Dies ist ein Geschenk von {quantity} {shareClassName}-Anteil(en) im Wert von {totalValue}."
```

**Step 2: Update the payment step in coop-register-content.tsx**

Find the payment/confirmation step rendering (Step 4 / the final step). When `beneficiaryType === 'gift'`, show the gift-specific copy instead of the standard confirmation text:

After the EPC QR code and bank details, add:

```tsx
{form.getValues('beneficiaryType') === 'gift' && (
  <div className="mt-6 p-4 rounded-lg border bg-amber-50 border-amber-200">
    <p className="text-sm text-amber-800 font-medium">
      {t('registration.giftPaymentNote')}
    </p>
  </div>
)}
```

**Step 3: Pass `isGift` in the API submission**

In the `handleSubmit` / form submission handler, when building the request body, add `isGift: true` when `beneficiaryType === 'gift'`:

Find where the API call is made (the `fetch` to `/coops/.../register`). Add to the body:

```typescript
isGift: values.beneficiaryType === 'gift',
```

**Step 4: Commit**

```bash
git add apps/web/src/components/coop-register-content.tsx \
        apps/web/messages/en.json \
        apps/web/messages/nl.json \
        apps/web/messages/fr.json \
        apps/web/messages/de.json
git commit -m "feat: update registration form to show gift note and pass isGift to API"
```

---

### Task 7: Frontend — Wire up claim page to real API

**Files:**
- Modify: `apps/web/src/app/[locale]/[coopSlug]/[channelSlug]/claim/page.tsx`
- Modify: `apps/web/messages/en.json`
- Modify: `apps/web/messages/nl.json`
- Modify: `apps/web/messages/fr.json`
- Modify: `apps/web/messages/de.json`

**Step 1: Add i18n keys for claim page**

Add under a `gift` section in each locale file:

**en.json:**
```json
"gift": {
  "claimTitle": "Claim Gift Certificate",
  "enterCode": "Enter your gift code",
  "validate": "Validate Code",
  "invalidCode": "Invalid or already claimed gift code.",
  "rateLimited": "Too many attempts. Please try again in 15 minutes.",
  "giftDetails": "Gift Details",
  "claimShares": "Claim Your Shares",
  "yourDetails": "Your Details",
  "successTitle": "Shares Claimed!",
  "successMessage": "Welcome! Your shares have been registered. You can now create an account to manage your shares.",
  "codePlaceholder": "XXXX-XXXX"
}
```

**nl.json:**
```json
"gift": {
  "claimTitle": "Cadeaubon Inwisselen",
  "enterCode": "Voer uw cadeaucode in",
  "validate": "Code Valideren",
  "invalidCode": "Ongeldige of reeds ingewisselde cadeaucode.",
  "rateLimited": "Te veel pogingen. Probeer het over 15 minuten opnieuw.",
  "giftDetails": "Cadeaudetails",
  "claimShares": "Claim Uw Aandelen",
  "yourDetails": "Uw Gegevens",
  "successTitle": "Aandelen Geclaimed!",
  "successMessage": "Welkom! Uw aandelen zijn geregistreerd. U kunt nu een account aanmaken om uw aandelen te beheren.",
  "codePlaceholder": "XXXX-XXXX"
}
```

**fr.json:**
```json
"gift": {
  "claimTitle": "Réclamer le Chèque-cadeau",
  "enterCode": "Entrez votre code cadeau",
  "validate": "Valider le Code",
  "invalidCode": "Code cadeau invalide ou déjà réclamé.",
  "rateLimited": "Trop de tentatives. Veuillez réessayer dans 15 minutes.",
  "giftDetails": "Détails du Cadeau",
  "claimShares": "Réclamez Vos Parts",
  "yourDetails": "Vos Détails",
  "successTitle": "Parts Réclamées!",
  "successMessage": "Bienvenue! Vos parts ont été enregistrées. Vous pouvez maintenant créer un compte pour gérer vos parts.",
  "codePlaceholder": "XXXX-XXXX"
}
```

**de.json:**
```json
"gift": {
  "claimTitle": "Geschenkgutschein Einlösen",
  "enterCode": "Geben Sie Ihren Geschenkcode ein",
  "validate": "Code Validieren",
  "invalidCode": "Ungültiger oder bereits eingelöster Geschenkcode.",
  "rateLimited": "Zu viele Versuche. Bitte versuchen Sie es in 15 Minuten erneut.",
  "giftDetails": "Geschenkdetails",
  "claimShares": "Anteile Einlösen",
  "yourDetails": "Ihre Daten",
  "successTitle": "Anteile Eingelöst!",
  "successMessage": "Willkommen! Ihre Anteile wurden registriert. Sie können jetzt ein Konto erstellen, um Ihre Anteile zu verwalten.",
  "codePlaceholder": "XXXX-XXXX"
}
```

**Step 2: Rewrite claim page with real API calls**

Rewrite `apps/web/src/app/[locale]/[coopSlug]/[channelSlug]/claim/page.tsx` to:

1. Call `GET /coops/:slug/channels/:channelSlug/gift/:code/validate` on validate
2. Show gift details (share class, quantity, value) after validation
3. Call `POST /coops/:slug/channels/:channelSlug/claim` on form submit
4. Handle 429 (rate limit) errors with user-friendly message
5. Replace `DatePicker` with native `<input type="date">` (matching the convention from the registration form fix)
6. Update header to use the same light/white style as the registration flow

Key changes from the existing stub:
- `handleValidateCode`: real fetch to validate endpoint, store gift details in state
- `onSubmit`: real fetch to claim endpoint with full shareholder data
- Error handling for 429 status (rate limited)
- Display gift details between code validation and form

**Step 3: Commit**

```bash
git add apps/web/src/app/[locale]/[coopSlug]/[channelSlug]/claim/page.tsx \
        apps/web/messages/en.json \
        apps/web/messages/nl.json \
        apps/web/messages/fr.json \
        apps/web/messages/de.json
git commit -m "feat: wire up gift claim page to real API with validation and error handling"
```

---

### Task 8: Build and test end-to-end

**Step 1: Install qrcode package if needed**

```bash
cd apps/api && pnpm add qrcode && pnpm add -D @types/qrcode && cd ../..
```

**Step 2: Build all packages**

```bash
pnpm build
```

Fix any TypeScript errors.

**Step 3: Start dev servers and test**

```bash
pnpm dev
```

Test the full flow:
1. Go to `http://localhost:3002/nl/demo/default/register`
2. Select "Cadeaubon" as beneficiary type
3. Fill in buyer email, select shares, proceed to payment
4. Verify the payment step shows the gift note
5. As admin, complete the registration manually
6. Check that a gift code was generated (via Prisma Studio or API)
7. Go to `http://localhost:3002/nl/demo/default/claim?code=XXXX-XXXX`
8. Verify code validates and shows gift details
9. Fill in recipient details, submit
10. Verify recipient shareholder was created and shares transferred

**Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: end-to-end testing fixes for gift certificate flow"
```
