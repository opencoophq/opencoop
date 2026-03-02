import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TransactionsService } from '../transactions/transactions.service';

@Injectable()
export class BankImportService {
  constructor(
    private prisma: PrismaService,
    private transactionsService: TransactionsService,
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
            transaction: {
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

      let matchedPaymentId: string | null = null;
      let matchStatus: 'UNMATCHED' | 'AUTO_MATCHED' = 'UNMATCHED';

      // Try auto-match by OGM code
      if (ogmCode) {
        const payment = await this.prisma.payment.findUnique({
          where: { ogmCode },
        });

        if (payment && payment.coopId === coopId && payment.status === 'PENDING') {
          matchedPaymentId = payment.id;
          matchStatus = 'AUTO_MATCHED';
          matchedCount++;

          // Update payment status
          await this.prisma.payment.update({
            where: { id: payment.id },
            data: { status: 'MATCHED' },
          });

          // Auto-complete the transaction (activates the share)
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
              date,
            );
          }
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
          matchedPaymentId,
        },
      });
    }

    // Update import counts
    return this.prisma.bankImport.update({
      where: { id: bankImport.id },
      data: { matchedCount, unmatchedCount },
    });
  }

  async manualMatch(bankTransactionId: string, paymentId: string, userId: string) {
    const bankTx = await this.prisma.bankTransaction.findUnique({
      where: { id: bankTransactionId },
    });

    if (!bankTx) {
      throw new NotFoundException('Bank transaction not found');
    }

    if (bankTx.matchStatus !== 'UNMATCHED') {
      throw new BadRequestException('Bank transaction is already matched');
    }

    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
    });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    // Update bank transaction
    await this.prisma.bankTransaction.update({
      where: { id: bankTransactionId },
      data: {
        matchedPaymentId: paymentId,
        matchStatus: 'MANUAL_MATCHED',
      },
    });

    // Update payment status
    await this.prisma.payment.update({
      where: { id: paymentId },
      data: { status: 'MATCHED' },
    });

    // Auto-complete the transaction
    const paymentWithTx = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      select: { transaction: { select: { id: true, status: true } } },
    });
    if (
      paymentWithTx?.transaction &&
      (paymentWithTx.transaction.status === 'AWAITING_PAYMENT' ||
        paymentWithTx.transaction.status === 'APPROVED')
    ) {
      await this.transactionsService.complete(
        paymentWithTx.transaction.id,
        userId,
        bankTx.date,
      );
    }

    return { success: true };
  }
}
