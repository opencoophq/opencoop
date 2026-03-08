import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RegistrationsService } from '../registrations/registrations.service';
import { computeTotalPaid } from '@opencoop/shared';

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
    let skippedCount = 0;
    const completedGiftRegistrationIds: string[] = [];

    for (const line of dataLines) {
      const fields = line.split(';').map((f) => f.trim().replace(/^"|"$/g, ''));
      if (fields.length < 4) {
        skippedCount++;
        continue;
      }

      // Generic CSV: date;amount;counterparty;reference
      const [dateStr, amountStr, counterparty, reference] = fields;

      const date = new Date(dateStr);
      const amount = parseFloat(amountStr.replace(',', '.'));

      if (isNaN(date.getTime()) || isNaN(amount)) {
        skippedCount++;
        continue;
      }

      // S7b: Skip negative amounts (debit transactions)
      if (amount <= 0) {
        await this.prisma.bankTransaction.create({
          data: {
            coopId,
            bankImportId: bankImport.id,
            date,
            amount,
            counterparty: counterparty || null,
            ogmCode: null,
            referenceText: reference || null,
            matchStatus: 'UNMATCHED',
          },
        });
        unmatchedCount++;
        continue;
      }

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

          // I1: Wrap entire auto-match in a transaction
          await this.prisma.$transaction(async (tx) => {
            const bankTx = await tx.bankTransaction.create({
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

            await tx.payment.create({
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

            // Check if fully paid and auto-complete
            const allPayments = await tx.payment.findMany({
              where: { registrationId: registration.id },
              select: { amount: true },
            });
            const totalPaid = computeTotalPaid(allPayments);

            if (totalPaid >= Number(registration.totalAmount)) {
              await tx.registration.update({
                where: { id: registration.id },
                data: {
                  status: 'COMPLETED',
                  processedAt: new Date(),
                },
              });

              // Track gift registrations that need code generation
              if (registration.isGift) {
                completedGiftRegistrationIds.push(registration.id);
              }
            } else if (registration.status === 'PENDING_PAYMENT') {
              await tx.registration.update({
                where: { id: registration.id },
                data: { status: 'ACTIVE' },
              });
            }
          });

          continue;
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

    // Generate gift codes for completed gift registrations
    for (const regId of completedGiftRegistrationIds) {
      await this.registrationsService.onRegistrationCompleted(regId);
    }

    // S7: Include skipped count in response
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

    // I1: Wrap manual match in a transaction
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.payment.create({
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

      await tx.bankTransaction.update({
        where: { id: bankTransactionId },
        data: { matchStatus: 'MANUAL_MATCHED' },
      });

      // Auto-complete if fully paid
      let isCompleted = false;
      if (
        registration.status === 'PENDING_PAYMENT' ||
        registration.status === 'ACTIVE'
      ) {
        const allPayments = await tx.payment.findMany({
          where: { registrationId },
          select: { amount: true },
        });
        const totalPaid = computeTotalPaid(allPayments);

        if (totalPaid >= Number(registration.totalAmount)) {
          await tx.registration.update({
            where: { id: registrationId },
            data: {
              status: 'COMPLETED',
              processedAt: new Date(),
            },
          });
          isCompleted = true;
        } else if (registration.status === 'PENDING_PAYMENT') {
          await tx.registration.update({
            where: { id: registrationId },
            data: { status: 'ACTIVE' },
          });
        }
      }

      return { success: true, isCompleted };
    });

    if (result.isCompleted) {
      await this.registrationsService.onRegistrationCompleted(registrationId);
    }

    return { success: true };
  }
}
