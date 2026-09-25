import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RegistrationsService } from '../registrations/registrations.service';
import { ShareholderStatusService } from '../shareholder-status/shareholder-status.service';
import { computeTotalPaid, extractOgmCode } from '@opencoop/shared';
import { BankPreset, BANK_PRESETS } from './bank-presets';
import { BankMatchingService } from './bank-matching.service';

@Injectable()
export class BankImportService {
  constructor(
    private prisma: PrismaService,
    private registrationsService: RegistrationsService,
    private shareholderStatus: ShareholderStatusService,
    private bankMatchingService: BankMatchingService,
  ) {}

  async getImports(coopId: string) {
    return this.prisma.bankImport.findMany({
      where: { coopId },
      orderBy: { importedAt: 'desc' },
    });
  }

  async getTransactions(
    coopId: string,
    bankImportId?: string,
    matchStatus?: string,
    search?: string,
  ) {
    const where: Record<string, unknown> = { coopId };
    if (bankImportId) where.bankImportId = bankImportId;
    if (matchStatus) where.matchStatus = matchStatus;
    if (search) {
      where.OR = [
        { counterparty: { contains: search, mode: 'insensitive' } },
        { referenceText: { contains: search, mode: 'insensitive' } },
      ];
    }

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

  async getUnmatchedTransactions(coopId: string) {
    return this.prisma.bankTransaction.findMany({
      where: {
        coopId,
        matchStatus: 'UNMATCHED',
        pontoTransactionId: { not: null },
        amount: { gt: 0 },
      },
      orderBy: { date: 'desc' },
    });
  }

  async importCsv(
    coopId: string,
    importedById: string,
    fileName: string,
    fileBuffer: Buffer,
    presetId: string = 'generic',
  ) {
    const preset = BANK_PRESETS[presetId];
    if (!preset) {
      throw new BadRequestException(`Unknown bank preset: ${presetId}`);
    }

    const csvContent = fileBuffer.toString(preset.encoding);
    return this.importCsvContent(coopId, importedById, fileName, csvContent, preset);
  }

  async importCsvText(
    coopId: string,
    importedById: string,
    fileName: string,
    csvContent: string,
    presetId: string = 'generic',
  ) {
    const preset = BANK_PRESETS[presetId];
    if (!preset) {
      throw new BadRequestException(`Unknown bank preset: ${presetId}`);
    }

    return this.importCsvContent(coopId, importedById, fileName, csvContent, preset);
  }

  private async importCsvContent(
    coopId: string,
    importedById: string,
    fileName: string,
    csvContent: string,
    preset: BankPreset,
  ) {
    const rows = this.parseCsv(csvContent, preset);

    if (rows.length === 0) {
      throw new BadRequestException('CSV file is empty or has no valid data rows');
    }

    const minDate = new Date(
      Math.min(...rows.map((row) => new Date(row.date.getFullYear(), row.date.getMonth(), row.date.getDate()).getTime())),
    );
    const maxDate = new Date(
      Math.max(...rows.map((row) => new Date(row.date.getFullYear(), row.date.getMonth(), row.date.getDate()).getTime())),
    );
    maxDate.setHours(23, 59, 59, 999);

    const existingTransactions = await this.prisma.bankTransaction.findMany({
      where: { coopId, date: { gte: minDate, lte: maxDate } },
      select: { date: true, amount: true, counterparty: true, referenceText: true },
    });
    const existingCounts = new Map<string, number>();
    for (const transaction of existingTransactions) {
      const key = this.getDedupeKey(transaction);
      existingCounts.set(key, (existingCounts.get(key) ?? 0) + 1);
    }

    const fileCounts = new Map<string, number>();
    for (const row of rows) {
      const key = this.getDedupeKey({
        date: row.date,
        amount: row.amount,
        counterparty: row.counterparty,
        referenceText: row.reference,
      });
      fileCounts.set(key, (fileCounts.get(key) ?? 0) + 1);
    }

    const importedCounts = new Map<string, number>();
    const importRows = rows.filter((row) => {
      const key = this.getDedupeKey({
        date: row.date,
        amount: row.amount,
        counterparty: row.counterparty,
        referenceText: row.reference,
      });
      const importedCount = importedCounts.get(key) ?? 0;
      const existingCount = existingCounts.get(key) ?? 0;
      importedCounts.set(key, importedCount + 1);
      return importedCount < Math.max(0, (fileCounts.get(key) ?? 0) - existingCount);
    });
    const skippedCount = rows.length - importRows.length;

    const bankImport = await this.prisma.bankImport.create({
      data: {
        coopId,
        fileName,
        importedById,
        rowCount: importRows.length,
      },
    });

    let matchedCount = 0;
    let unmatchedCount = 0;

    const uniqueOgms = [
      ...new Set(
        importRows
          .filter((row) => row.amount > 0)
          .map((row) => extractOgmCode(row.reference))
          .filter((ogmCode): ogmCode is string => ogmCode !== null),
      ),
    ];
    const registrationMap = new Map<string, any>();
    if (uniqueOgms.length > 0) {
      const registrations = await this.prisma.registration.findMany({
        where: { coopId, ogmCode: { in: uniqueOgms } },
        select: {
          id: true,
          coopId: true,
          status: true,
          totalAmount: true,
          ogmCode: true,
          payments: {
            select: { id: true, amount: true, bankDate: true, bankTransactionId: true },
          },
        },
      });
      for (const registration of registrations) {
        if (registration.ogmCode) registrationMap.set(registration.ogmCode, registration);
      }
    }

    for (const row of importRows) {
      const ogmCode = extractOgmCode(row.reference);
      if (row.amount <= 0) {
        await this.prisma.bankTransaction.create({
          data: {
            coopId,
            bankImportId: bankImport.id,
            date: row.date,
            amount: row.amount,
            counterparty: row.counterparty || null,
            ogmCode,
            referenceText: row.reference || null,
            matchStatus: 'IGNORED',
          },
        });
        continue;
      }

      const bankTransaction = await this.prisma.bankTransaction.create({
        data: {
          coopId,
          bankImportId: bankImport.id,
          date: row.date,
          amount: row.amount,
          counterparty: row.counterparty || null,
          ogmCode,
          referenceText: row.reference || null,
          matchStatus: 'UNMATCHED',
        },
      });

      const result = await this.bankMatchingService.matchTransaction(coopId, {
        id: bankTransaction.id,
        date: row.date,
        amount: row.amount,
        referenceText: row.reference || null,
        ogmCode,
      }, importedById, true, ogmCode ? registrationMap.get(ogmCode) : undefined);
      if (result.status === 'AUTO_MATCHED') matchedCount++;
      else unmatchedCount++;
    }

    const updatedImport = await this.prisma.bankImport.update({
      where: { id: bankImport.id },
      data: { matchedCount, unmatchedCount },
    });
    return { ...updatedImport, skippedCount };
  }

  private getDedupeKey(transaction: {
    date: Date;
    amount: unknown;
    counterparty?: string | null;
    referenceText?: string | null;
  }): string {
    const date = transaction.date;
    const calendarDate = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
    const amountInCents = Math.round(Number(transaction.amount) * 100);
    const normalize = (value: string | null | undefined) => (value ?? '').trim().replace(/\s+/g, ' ');
    return JSON.stringify([
      calendarDate,
      amountInCents,
      normalize(transaction.counterparty),
      normalize(transaction.referenceText),
    ]);
  }

  private parseCsv(
    csvContent: string,
    preset: BankPreset,
  ): { date: Date; amount: number; counterparty: string; reference: string }[] {
    const lines = csvContent.split(/\r?\n/).filter((l) => l.trim());

    if (preset.id === 'generic') {
      return this.parseGenericCsv(lines);
    }

    // Header-based parsing for bank presets: the header is the first line that
    // names both the date and the amount column (banks prepend metadata blocks).
    const headerIdx = lines.findIndex((line) => {
      const cells = this.splitCsvLine(line, preset.delimiter);
      return cells.includes(preset.dateColumn) && cells.includes(preset.amountColumn);
    });
    if (headerIdx === -1) return [];

    const headers = this.splitCsvLine(lines[headerIdx], preset.delimiter);
    const rows = lines.slice(headerIdx + 1);

    const colIndex = (name: string) => headers.indexOf(name);
    const dateIdx = colIndex(preset.dateColumn);
    const amountIdx = colIndex(preset.amountColumn);
    const counterpartyIdx = colIndex(preset.counterpartyColumn);
    const referenceIdx = colIndex(preset.referenceColumn);
    const signIdx = preset.amountSign ? colIndex(preset.amountSign.column) : -1;

    if (dateIdx === -1 || amountIdx === -1) return [];

    const result: { date: Date; amount: number; counterparty: string; reference: string }[] = [];

    for (const line of rows) {
      const fields = this.splitCsvLine(line, preset.delimiter);
      if (fields.length <= Math.max(dateIdx, amountIdx)) continue;

      const date = this.parseDate(fields[dateIdx], preset.dateFormat);
      let amount = this.parseAmount(fields[amountIdx], preset.decimalSeparator);

      if (!date || amount === null) continue;

      if (preset.amountSign && signIdx !== -1) {
        const signValue = fields[signIdx]?.trim();
        if (signValue === preset.amountSign.debitValue) {
          amount = -Math.abs(amount);
        } else if (signValue === preset.amountSign.creditValue) {
          amount = Math.abs(amount);
        }
      }

      result.push({
        date,
        amount,
        counterparty: counterpartyIdx >= 0 ? fields[counterpartyIdx]?.trim() || '' : '',
        reference: referenceIdx >= 0 ? fields[referenceIdx]?.trim() || '' : '',
      });
    }

    return result;
  }

  private parseGenericCsv(
    lines: string[],
  ): { date: Date; amount: number; counterparty: string; reference: string }[] {
    if (lines.length < 2) return [];

    const dataLines = lines.slice(1);
    const result: { date: Date; amount: number; counterparty: string; reference: string }[] = [];

    for (const line of dataLines) {
      const fields = line.split(';').map((f) => f.trim().replace(/^"|"$/g, ''));
      if (fields.length < 4) continue;

      const [dateStr, amountStr, counterparty, reference] = fields;
      const date = this.parseDate(dateStr, 'ISO');
      const amount = parseFloat(amountStr.replace(',', '.'));

      if (!date || isNaN(amount)) continue;

      result.push({ date, amount, counterparty, reference });
    }

    return result;
  }

  private splitCsvLine(line: string, delimiter: string): string[] {
    const fields: string[] = [];
    let current = '';
    let inQuotes = false;

    for (const char of line) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === delimiter && !inQuotes) {
        fields.push(current.trim().replace(/^"|"$/g, ''));
        current = '';
      } else {
        current += char;
      }
    }
    fields.push(current.trim().replace(/^"|"$/g, ''));
    return fields;
  }

  private parseDate(value: string, format: string): Date | null {
    const trimmed = value?.trim();
    if (!trimmed) return null;

    if (format === 'DD/MM/YYYY') {
      const parts = trimmed.split('/');
      if (parts.length !== 3) return null;
      const day = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const year = parseInt(parts[2], 10);
      if (isNaN(day) || isNaN(month) || isNaN(year)) return null;
      return new Date(year, month, day);
    }

    const isoDateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
    if (isoDateOnly) {
      return new Date(Number(isoDateOnly[1]), Number(isoDateOnly[2]) - 1, Number(isoDateOnly[3]));
    }

    // ISO or native fallback
    const d = new Date(trimmed);
    return isNaN(d.getTime()) ? null : d;
  }

  private parseAmount(value: string, decimalSeparator: ',' | '.'): number | null {
    if (!value?.trim()) return null;
    let cleaned = value.trim().replace(/\s/g, '');
    if (decimalSeparator === ',') {
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      cleaned = cleaned.replace(/,/g, '');
    }
    const num = parseFloat(cleaned);
    return isNaN(num) ? null : num;
  }

  async manualMatch(
    coopId: string,
    bankTransactionId: string,
    target: { registrationId?: string; paymentId?: string },
    userId: string,
  ) {
    const { registrationId, paymentId } = target;
    if ((registrationId && paymentId) || (!registrationId && !paymentId)) {
      throw new BadRequestException('Provide either registrationId or paymentId');
    }

    const bankTx = await this.prisma.bankTransaction.findFirst({
      where: { id: bankTransactionId, coopId },
    });

    if (!bankTx) {
      throw new NotFoundException('Bank transaction not found');
    }

    if (bankTx.matchStatus !== 'UNMATCHED') {
      throw new BadRequestException('Bank transaction is already matched');
    }

    if (paymentId) {
      const payment = await this.prisma.payment.findFirst({
        where: { id: paymentId, coopId },
      });
      if (!payment) {
        throw new NotFoundException('Payment not found');
      }
      if (payment.bankTransactionId) {
        throw new BadRequestException('Payment is already matched');
      }
      if (this.toCents(payment.amount) !== this.toCents(bankTx.amount)) {
        throw new BadRequestException('Payment amount must exactly match the bank transaction amount');
      }

      // Claim both rows only while they are still free, so a concurrent link cannot be
      // overwritten silently.
      await this.prisma.$transaction(async (tx) => {
        const claimedPayment = await tx.payment.updateMany({
          where: { id: paymentId, bankTransactionId: null },
          data: {
            bankTransactionId,
            matchedByUserId: userId,
            matchedAt: new Date(),
          },
        });
        const claimedTransaction = await tx.bankTransaction.updateMany({
          where: { id: bankTransactionId, matchStatus: 'UNMATCHED' },
          data: { matchStatus: 'MANUAL_MATCHED' },
        });
        if (claimedPayment.count !== 1 || claimedTransaction.count !== 1) {
          throw new ConflictException('Payment or bank transaction was linked in the meantime');
        }
      });

      return { success: true };
    }

    const registration = await this.prisma.registration.findFirst({
      where: { id: registrationId, coopId },
    });

    if (!registration) {
      throw new NotFoundException('Registration not found');
    }
    if (!['PENDING_PAYMENT', 'ACTIVE'].includes(registration.status)) {
      throw new BadRequestException(
        'Registration is already fully paid — link the existing payment instead',
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.payment.create({
        data: {
          registrationId: registrationId!,
          coopId: registration.coopId,
          amount: Number(bankTx.amount),
          bankDate: bankTx.date,
          bankTransactionId,
          matchedByUserId: userId,
          matchedAt: new Date(),
        },
      });

      const claimedTransaction = await tx.bankTransaction.updateMany({
        where: { id: bankTransactionId, matchStatus: 'UNMATCHED' },
        data: { matchStatus: 'MANUAL_MATCHED' },
      });
      if (claimedTransaction.count !== 1) {
        throw new ConflictException('Bank transaction was linked in the meantime');
      }

      let isCompleted = false;
      let isActive = false;
      if (registration.status === 'PENDING_PAYMENT' || registration.status === 'ACTIVE') {
        const allPayments = await tx.payment.findMany({
          where: { registrationId: registrationId! },
          select: { amount: true },
        });
        const totalPaid = computeTotalPaid(allPayments);

        if (totalPaid >= Number(registration.totalAmount)) {
          await tx.registration.update({
            where: { id: registrationId! },
            data: {
              status: 'COMPLETED',
              processedAt: new Date(),
            },
          });
          isCompleted = true;
        } else if (registration.status === 'PENDING_PAYMENT') {
          await tx.registration.update({
            where: { id: registrationId! },
            data: { status: 'ACTIVE' },
          });
          isActive = true;
        }
      }

      return { success: true, isCompleted, isActive, shareholderId: registration.shareholderId };
    });

    if (result.isCompleted) {
      await this.registrationsService.onRegistrationCompleted(registrationId!);
    } else if (result.isActive) {
      await this.shareholderStatus.recompute(result.shareholderId);
    }

    return { success: true };
  }

  async rematch(coopId: string, matchedByUserId?: string) {
    const unmatched = await this.prisma.bankTransaction.findMany({
      where: { coopId, matchStatus: 'UNMATCHED' },
      select: { id: true, date: true, amount: true, referenceText: true, ogmCode: true },
    });
    const outgoing = unmatched.filter((transaction) => Number(transaction.amount) < 0);
    let ignoredOutgoing = 0;
    if (outgoing.length > 0) {
      const result = await this.prisma.bankTransaction.updateMany({
        where: { coopId, id: { in: outgoing.map((transaction) => transaction.id) }, matchStatus: 'UNMATCHED' },
        data: { matchStatus: 'IGNORED' },
      });
      ignoredOutgoing = result.count;
    }

    const incoming = unmatched.filter((transaction) => Number(transaction.amount) > 0);
    let linkedExisting = 0;
    let createdPayments = 0;
    let stillUnmatched = 0;
    for (const transaction of incoming) {
      const result = await this.bankMatchingService.matchTransaction(coopId, transaction, matchedByUserId);
      if (result.linkedExisting) linkedExisting++;
      if (result.createdPayment) createdPayments++;
      if (result.status === 'UNMATCHED') stillUnmatched++;
    }

    return {
      checked: incoming.length,
      linkedExisting,
      createdPayments,
      stillUnmatched,
      ignoredOutgoing,
    };
  }

  async ignoreTransactions(coopId: string, ids: string[]) {
    return this.updateIgnoredStatus(coopId, ids, 'UNMATCHED', 'IGNORED');
  }

  async unignoreTransactions(coopId: string, ids: string[]) {
    return this.updateIgnoredStatus(coopId, ids, 'IGNORED', 'UNMATCHED');
  }

  private async updateIgnoredStatus(
    coopId: string,
    ids: string[],
    fromStatus: 'UNMATCHED' | 'IGNORED',
    toStatus: 'UNMATCHED' | 'IGNORED',
  ) {
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length === 0) return { [toStatus === 'IGNORED' ? 'ignored' : 'unignored']: 0, skipped: 0 };

    const transactions = await this.prisma.bankTransaction.findMany({
      where: { coopId, id: { in: uniqueIds } },
      select: { id: true, matchStatus: true },
    });
    if (transactions.length !== uniqueIds.length) {
      throw new NotFoundException('Bank transaction not found');
    }

    const updated = await this.prisma.bankTransaction.updateMany({
      where: { coopId, id: { in: uniqueIds }, matchStatus: fromStatus },
      data: { matchStatus: toStatus },
    });
    return {
      [toStatus === 'IGNORED' ? 'ignored' : 'unignored']: updated.count,
      skipped: uniqueIds.length - updated.count,
    };
  }

  private toCents(amount: unknown): number {
    return Math.round(Number(amount) * 100);
  }
}
