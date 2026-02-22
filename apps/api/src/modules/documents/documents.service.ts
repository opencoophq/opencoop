import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { renderToBuffer } from '@react-pdf/renderer';
import { ShareCertificate } from '@opencoop/pdf-templates';
import React from 'react';
import * as fs from 'fs';
import * as path from 'path';

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
      nationalId: shareholder.nationalId || undefined,
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
}
