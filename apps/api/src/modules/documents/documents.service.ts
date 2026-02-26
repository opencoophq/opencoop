import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { renderToBuffer } from '@react-pdf/renderer';
import { ShareCertificate, DividendStatement } from '@opencoop/pdf-templates';
import React from 'react';
import * as fs from 'fs';
import * as path from 'path';
import { decryptField, isEncrypted } from '../../common/crypto';

@Injectable()
export class DocumentsService {
  constructor(private prisma: PrismaService) {}

  async generateCertificate(shareholderId: string, locale?: string) {
    const shareholder = await this.prisma.shareholder.findUnique({
      where: { id: shareholderId },
      include: {
        coop: true,
        shares: {
          where: { status: 'ACTIVE' },
          include: { shareClass: true },
        },
      },
    });

    if (!shareholder) {
      throw new NotFoundException('Shareholder not found');
    }

    if (shareholder.shares.length === 0) {
      throw new NotFoundException('No active shares found');
    }

    // Use first active share for certificate
    const share = shareholder.shares[0];
    const totalValue = share.quantity * Number(share.purchasePricePerShare);

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
      shareClassName: share.shareClass.name,
      shareClassCode: share.shareClass.code,
      quantity: share.quantity,
      pricePerShare: Number(share.purchasePricePerShare),
      totalValue,
      purchaseDate: share.purchaseDate.toISOString().split('T')[0],
      issueDate: new Date().toISOString().split('T')[0],
      locale: locale || 'nl',
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

    // Update share certificate number
    await this.prisma.share.update({
      where: { id: share.id },
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
