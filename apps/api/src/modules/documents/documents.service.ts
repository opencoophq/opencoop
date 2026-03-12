import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { renderToBuffer } from '@react-pdf/renderer';
import { ShareCertificate, DividendStatement, GiftCertificate } from '@opencoop/pdf-templates';
import React from 'react';
import * as fs from 'fs';
import * as path from 'path';
import { decryptField, isEncrypted } from '../../common/crypto';

@Injectable()
export class DocumentsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Format a coop's coopAddress JSON into a single-line string.
   */
  private formatCoopAddress(coopAddress: unknown): string | undefined {
    if (!coopAddress || typeof coopAddress !== 'object') return undefined;
    const a = coopAddress as Record<string, string>;
    const parts = [
      [a.street, a.number].filter(Boolean).join(' '),
      a.postalCode,
      a.city,
      a.country,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(', ') : undefined;
  }

  /**
   * Extract the shareholder's city from the address JSON.
   */
  private getShareholderCity(address: unknown): string | undefined {
    if (!address || typeof address !== 'object') return undefined;
    return (address as Record<string, string>).city || undefined;
  }

  /**
   * Build the common certificate props from coop + shareholder data.
   */
  private buildCertificateCoopProps(coop: {
    legalForm?: string | null;
    foundedDate?: string | null;
    certificateSignatory?: string | null;
    coopAddress?: unknown;
    coopPhone?: string | null;
    coopEmail?: string | null;
    coopWebsite?: string | null;
    vatNumber?: string | null;
    bankIban?: string | null;
    bankBic?: string | null;
  }) {
    return {
      legalForm: coop.legalForm || undefined,
      foundedDate: coop.foundedDate || undefined,
      certificateSignatory: coop.certificateSignatory || undefined,
      coopAddress: this.formatCoopAddress(coop.coopAddress),
      coopPhone: coop.coopPhone || undefined,
      coopEmail: coop.coopEmail || undefined,
      coopWebsite: coop.coopWebsite || undefined,
      vatNumber: coop.vatNumber || undefined,
      bankIban: coop.bankIban || undefined,
      bankBic: coop.bankBic || undefined,
    };
  }

  async generateCertificate(shareholderId: string, locale?: string) {
    const shareholder = await this.prisma.shareholder.findUnique({
      where: { id: shareholderId },
      include: {
        coop: true,
        registrations: {
          where: { type: 'BUY', status: 'COMPLETED' },
          include: {
            shareClass: true,
            payments: { select: { amount: true, bankDate: true } },
          },
        },
      },
    });

    if (!shareholder) {
      throw new NotFoundException('Shareholder not found');
    }

    if (shareholder.registrations.length === 0) {
      throw new NotFoundException('No active registrations found');
    }

    // Use first completed buy registration for certificate
    const reg = shareholder.registrations[0];
    const totalPaid = reg.payments.reduce((s, p) => s + Number(p.amount), 0);
    const pricePerShare = Number(reg.pricePerShare);
    let vestedQuantity: number;

    // For imported registrations without payments, use full quantity
    if (reg.payments.length === 0) {
      vestedQuantity = reg.quantity;
    } else {
      vestedQuantity = pricePerShare > 0
        ? Math.min(Math.floor(totalPaid / pricePerShare), reg.quantity)
        : 0;
    }

    // S5: Don't generate certificate for 0 vested shares
    if (vestedQuantity <= 0) {
      throw new BadRequestException('No vested shares to certify — payment required first');
    }

    const totalValue = vestedQuantity * pricePerShare;

    const shareholderName =
      shareholder.type === 'COMPANY'
        ? shareholder.companyName || ''
        : `${shareholder.firstName || ''} ${shareholder.lastName || ''}`.trim();

    const certNumber = `${shareholder.coop.slug.toUpperCase()}-${Date.now()}`;

    const element = React.createElement(ShareCertificate, {
      certificateNumber: certNumber,
      coopName: shareholder.coop.name,
      shareholderName,
      shareholderType: shareholder.type,
      nationalId: shareholder.nationalId
        ? (isEncrypted(shareholder.nationalId) ? decryptField(shareholder.nationalId) : shareholder.nationalId)
        : undefined,
      companyId: shareholder.companyId || undefined,
      shareClassName: reg.shareClass.name,
      shareClassCode: reg.shareClass.code,
      quantity: vestedQuantity,
      pricePerShare,
      totalValue,
      purchaseDate: (reg.payments?.length
        ? reg.payments[reg.payments.length - 1].bankDate
        : null)?.toISOString().split('T')[0] || reg.registerDate.toISOString().split('T')[0],
      issueDate: new Date().toISOString().split('T')[0],
      locale: locale || 'nl',
      shareholderCity: this.getShareholderCity(shareholder.address),
      memberNumber: shareholder.memberNumber || undefined,
      ...this.buildCertificateCoopProps(shareholder.coop),
    });

    const buffer = await renderToBuffer(element as any);

    // Save file
    const uploadDir = process.env.UPLOAD_DIR || './uploads';
    const dir = path.join(uploadDir, 'certificates');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const filePath = path.join(dir, `${certNumber}.pdf`);
    fs.writeFileSync(filePath, buffer);

    // Create document record
    const doc = await this.prisma.shareholderDocument.create({
      data: {
        shareholderId,
        type: 'SHARE_CERTIFICATE',
        filePath,
      },
    });

    // Update registration certificate number
    await this.prisma.registration.update({
      where: { id: reg.id },
      data: { certificateNumber: certNumber },
    });

    return doc;
  }

  async generateCertificateForRegistration(registrationId: string, coopId: string, locale?: string) {
    const reg = await this.prisma.registration.findUnique({
      where: { id: registrationId, coopId },
      include: {
        shareholder: {
          include: { coop: true },
        },
        shareClass: true,
        payments: { select: { amount: true, bankDate: true } },
      },
    });

    if (!reg) {
      throw new NotFoundException('Registration not found');
    }

    if (reg.type !== 'BUY' || reg.status !== 'COMPLETED') {
      throw new BadRequestException(
        'Certificate can only be generated for completed BUY registrations',
      );
    }

    const shareholder = reg.shareholder;
    const coop = shareholder.coop;
    const pricePerShare = Number(reg.pricePerShare);
    let vestedQuantity: number;

    // For imported registrations without payments (e.g., Bronsgroen), use full quantity
    if (reg.payments.length === 0) {
      vestedQuantity = reg.quantity;
    } else {
      const totalPaid = reg.payments.reduce((s, p) => s + Number(p.amount), 0);
      vestedQuantity = pricePerShare > 0
        ? Math.min(Math.floor(totalPaid / pricePerShare), reg.quantity)
        : 0;
    }

    if (vestedQuantity <= 0) {
      throw new BadRequestException('No vested shares to certify — payment required first');
    }

    const totalValue = vestedQuantity * pricePerShare;

    const shareholderName =
      shareholder.type === 'COMPANY'
        ? shareholder.companyName || ''
        : `${shareholder.firstName || ''} ${shareholder.lastName || ''}`.trim();

    const certNumber = `${coop.slug.toUpperCase()}-${Date.now()}`;

    const element = React.createElement(ShareCertificate, {
      certificateNumber: certNumber,
      coopName: coop.name,
      shareholderName,
      shareholderType: shareholder.type,
      nationalId: shareholder.nationalId
        ? (isEncrypted(shareholder.nationalId) ? decryptField(shareholder.nationalId) : shareholder.nationalId)
        : undefined,
      companyId: shareholder.companyId || undefined,
      shareClassName: reg.shareClass.name,
      shareClassCode: reg.shareClass.code,
      quantity: vestedQuantity,
      pricePerShare,
      totalValue,
      purchaseDate: (reg.payments?.length
        ? reg.payments[reg.payments.length - 1].bankDate
        : null)?.toISOString().split('T')[0] || reg.registerDate.toISOString().split('T')[0],
      issueDate: new Date().toISOString().split('T')[0],
      locale: locale || 'nl',
      shareholderCity: this.getShareholderCity(shareholder.address),
      memberNumber: shareholder.memberNumber || undefined,
      ...this.buildCertificateCoopProps(coop),
    });

    const buffer = await renderToBuffer(element as any);

    // Save file
    const uploadDir = process.env.UPLOAD_DIR || './uploads';
    const dir = path.join(uploadDir, 'certificates');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const filePath = path.join(dir, `${certNumber}.pdf`);
    fs.writeFileSync(filePath, buffer);

    // Create document record
    const doc = await this.prisma.shareholderDocument.create({
      data: {
        shareholderId: shareholder.id,
        type: 'SHARE_CERTIFICATE',
        filePath,
      },
    });

    // Update registration certificate number
    await this.prisma.registration.update({
      where: { id: reg.id },
      data: { certificateNumber: certNumber },
    });

    return doc;
  }

  async getDocuments(shareholderId: string) {
    return this.prisma.shareholderDocument.findMany({
      where: { shareholderId },
      orderBy: { generatedAt: 'desc' },
    });
  }

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

  async generateDividendStatement(shareholderId: string, dividendPayoutId: string, locale?: string) {
    const payout = await this.prisma.dividendPayout.findUnique({
      where: { id: dividendPayoutId },
      include: {
        shareholder: {
          include: { coop: true },
        },
        dividendPeriod: true,
      },
    });

    if (!payout) {
      throw new NotFoundException('Dividend payout not found');
    }

    if (payout.shareholderId !== shareholderId) {
      throw new NotFoundException('Dividend payout not found');
    }

    const shareholder = payout.shareholder;

    const shareholderName =
      shareholder.type === 'COMPANY'
        ? shareholder.companyName || ''
        : `${shareholder.firstName || ''} ${shareholder.lastName || ''}`.trim();

    // Build details from calculationDetails if available
    const details = Array.isArray(payout.calculationDetails)
      ? (payout.calculationDetails as Array<{
          shareClassName?: string;
          quantity?: number;
          totalValue?: number;
          dividendRate?: number;
          dividendAmount?: number;
        }>).map((d) => ({
          shareClassName: d.shareClassName || '',
          quantity: d.quantity || 0,
          totalValue: d.totalValue || 0,
          dividendRate: d.dividendRate || 0,
          dividendAmount: d.dividendAmount || 0,
        }))
      : [{
          shareClassName: '-',
          quantity: 0,
          totalValue: 0,
          dividendRate: Number(payout.dividendPeriod.dividendRate),
          dividendAmount: Number(payout.grossAmount),
        }];

    const element = React.createElement(DividendStatement, {
      coopName: shareholder.coop.name,
      shareholderName,
      shareholderType: shareholder.type,
      nationalId: shareholder.nationalId
        ? (isEncrypted(shareholder.nationalId) ? decryptField(shareholder.nationalId) : shareholder.nationalId)
        : undefined,
      companyId: shareholder.companyId || undefined,
      year: payout.dividendPeriod.year,
      periodName: payout.dividendPeriod.name || undefined,
      exDividendDate: payout.dividendPeriod.exDividendDate.toISOString().split('T')[0],
      paymentDate: payout.dividendPeriod.paymentDate?.toISOString().split('T')[0],
      details,
      grossAmount: Number(payout.grossAmount),
      withholdingTax: Number(payout.withholdingTax),
      withholdingTaxRate: Number(payout.dividendPeriod.withholdingTaxRate),
      netAmount: Number(payout.netAmount),
      locale: locale || 'nl',
    });

    const buffer = await renderToBuffer(element as any);

    // Save file
    const uploadDir = process.env.UPLOAD_DIR || './uploads';
    const dir = path.join(uploadDir, 'statements');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const fileName = `STMT-${shareholder.coop.slug.toUpperCase()}-${payout.dividendPeriod.year}-${Date.now()}`;
    const filePath = path.join(dir, `${fileName}.pdf`);
    fs.writeFileSync(filePath, buffer);

    // Create document record
    const doc = await this.prisma.shareholderDocument.create({
      data: {
        shareholderId,
        type: 'DIVIDEND_STATEMENT',
        filePath,
      },
    });

    // Link to payout
    await this.prisma.dividendPayout.update({
      where: { id: dividendPayoutId },
      data: { statementDocumentId: doc.id },
    });

    return doc;
  }
}
