import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RegistrationsService } from '../registrations/registrations.service';

@Injectable()
export class BankImportService {
  constructor(
    private prisma: PrismaService,
    private registrationsService: RegistrationsService,
  ) {}

  async getImports(coopId: string) {
    return this.prisma.bankImport.findMany({
      where: { coopId },
      orderBy: { importedAt: 'desc' },
    });
  }

  async getTransactions(coopId: string, bankImportId?: string, matchStatus?: string) {
    const where: Record<string, unknown> = { coopId };
    if (bankImportId) where.bankImportId = bankImportId;
    if (matchStatus) where.matchStatus = matchStatus;

    return this.prisma.bankTransaction.findMany({
      where,
      include: {
        matchedPayment: {
          include: {
            registration: {
              include: {
                shareholder: {
                  select: { firstName: true, lastName: true, companyName: true },
                },
              },
            },
          },
        },
      },
      orderBy: { date: 'desc' },
    });
  }

  async importBelfiusCsv(
    coopId: string,
    importedById: string,
    fileName: string,
    csvContent: string,
  ) {
    const lines = csvContent.split('\n').filter((l) => l.trim());
    if (lines.length < 2) {
      throw new BadRequestException('CSV file is empty or has no data rows');
    }

    // Skip header row
    const dataLines = lines.slice(1);

    // Create bank import record
    const bankImport = await this.prisma.bankImport.create({
      data: {
        coopId,
        fileName,
        importedById,
        rowCount: dataLines.length,
      },
    });

    let matchedCount = 0;
    let unmatchedCount = 0;

    for (const line of dataLines) {
      const fields = line.split(';').map((f) => f.trim().replace(/^"|"$/g, ''));
      if (fields.length < 4) continue;

      // Generic CSV: date;amount;counterparty;reference
      const [dateStr, amountStr, counterparty, reference] = fields;

      const date = new Date(dateStr);
      const amount = parseFloat(amountStr.replace(',', '.'));

      if (isNaN(date.getTime()) || isNaN(amount)) continue;

      // Extract OGM code from reference (pattern: +++XXX/XXXX/XXXXX+++)
      const ogmMatch = reference?.match(/\+\+\+\d{3}\/\d{4}\/\d{5}\+\+\+/);
      const ogmCode = ogmMatch ? ogmMatch[0] : null;

      let matchStatus: 'UNMATCHED' | 'AUTO_MATCHED' = 'UNMATCHED';

      // Try auto-match by OGM code on Registration
      if (ogmCode) {
        const registration = await this.prisma.registration.findUnique({
          where: { ogmCode },
        });

        if (
          registration &&
          registration.coopId === coopId &&
          (registration.status === 'PENDING_PAYMENT' || registration.status === 'ACTIVE')
        ) {
          matchStatus = 'AUTO_MATCHED';
          matchedCount++;

          // Create a bank transaction first so we can link the payment to it
          const bankTx = await this.prisma.bankTransaction.create({
            data: {
              coopId,
              bankImportId: bankImport.id,
              date,
              amount,
              counterparty: counterparty || null,
              ogmCode,
              referenceText: reference || null,
              matchStatus,
            },
          });

          // Create a Payment record linked to this registration and bank transaction
          await this.prisma.payment.create({
            data: {
              registrationId: registration.id,
              coopId,
              amount,
              bankDate: date,
              bankTransactionId: bankTx.id,
              matchedByUserId: importedById,
              matchedAt: new Date(),
            },
          });

          // Auto-complete the registration if fully paid
          const allPayments = await this.prisma.payment.findMany({
            where: { registrationId: registration.id },
            select: { amount: true },
          });
          const totalPaid = allPayments.reduce((s, p) => s + Number(p.amount), 0);

          if (totalPaid >= Number(registration.totalAmount)) {
            await this.registrationsService.complete(
              registration.id,
              importedById,
              date,
            );
          }

          continue; // bankTransaction already created above
        } else {
          unmatchedCount++;
        }
      } else {
        unmatchedCount++;
      }

      await this.prisma.bankTransaction.create({
        data: {
          coopId,
          bankImportId: bankImport.id,
          date,
          amount,
          counterparty: counterparty || null,
          ogmCode,
          referenceText: reference || null,
          matchStatus,
        },
      });
    }

    // Update import counts
    return this.prisma.bankImport.update({
      where: { id: bankImport.id },
      data: { matchedCount, unmatchedCount },
    });
  }

  async manualMatch(bankTransactionId: string, registrationId: string, userId: string) {
    const bankTx = await this.prisma.bankTransaction.findUnique({
      where: { id: bankTransactionId },
    });

    if (!bankTx) {
      throw new NotFoundException('Bank transaction not found');
    }

    if (bankTx.matchStatus !== 'UNMATCHED') {
      throw new BadRequestException('Bank transaction is already matched');
    }

    const registration = await this.prisma.registration.findUnique({
      where: { id: registrationId },
    });

    if (!registration) {
      throw new NotFoundException('Registration not found');
    }

    // Create a Payment record linked to this registration and bank transaction
    const payment = await this.prisma.payment.create({
      data: {
        registrationId,
        coopId: registration.coopId,
        amount: Number(bankTx.amount),
        bankDate: bankTx.date,
        bankTransactionId,
        matchedByUserId: userId,
        matchedAt: new Date(),
      },
    });

    // Update bank transaction match status
    await this.prisma.bankTransaction.update({
      where: { id: bankTransactionId },
      data: {
        matchStatus: 'MANUAL_MATCHED',
      },
    });

    // Auto-complete the registration if fully paid
    if (
      registration.status === 'PENDING_PAYMENT' ||
      registration.status === 'ACTIVE'
    ) {
      const allPayments = await this.prisma.payment.findMany({
        where: { registrationId },
        select: { amount: true },
      });
      const totalPaid = allPayments.reduce((s, p) => s + Number(p.amount), 0);

      if (totalPaid >= Number(registration.totalAmount)) {
        await this.registrationsService.complete(
          registration.id,
          userId,
          bankTx.date,
        );
      }
    }

    return { success: true };
  }
}
