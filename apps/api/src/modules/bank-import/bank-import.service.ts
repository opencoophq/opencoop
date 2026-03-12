import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RegistrationsService } from '../registrations/registrations.service';
import { computeTotalPaid } from '@opencoop/shared';
import { BankPreset, BANK_PRESETS } from './bank-presets';

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
    const rows = this.parseCsv(csvContent, preset);

    if (rows.length === 0) {
      throw new BadRequestException('CSV file is empty or has no valid data rows');
    }

    const bankImport = await this.prisma.bankImport.create({
      data: {
        coopId,
        fileName,
        importedById,
        rowCount: rows.length,
      },
    });

    let matchedCount = 0;
    let unmatchedCount = 0;
    const completedGiftRegistrationIds: string[] = [];

    for (const row of rows) {
      if (row.amount <= 0) {
        await this.prisma.bankTransaction.create({
          data: {
            coopId,
            bankImportId: bankImport.id,
            date: row.date,
            amount: row.amount,
            counterparty: row.counterparty || null,
            ogmCode: null,
            referenceText: row.reference || null,
            matchStatus: 'UNMATCHED',
          },
        });
        unmatchedCount++;
        continue;
      }

      const ogmMatch = row.reference?.match(/\+\+\+\d{3}\/\d{4}\/\d{5}\+\+\+/);
      const ogmCode = ogmMatch ? ogmMatch[0] : null;
      let matchStatus: 'UNMATCHED' | 'AUTO_MATCHED' = 'UNMATCHED';

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

          await this.prisma.$transaction(async (tx) => {
            const bankTx = await tx.bankTransaction.create({
              data: {
                coopId,
                bankImportId: bankImport.id,
                date: row.date,
                amount: row.amount,
                counterparty: row.counterparty || null,
                ogmCode,
                referenceText: row.reference || null,
                matchStatus,
              },
            });

            await tx.payment.create({
              data: {
                registrationId: registration.id,
                coopId,
                amount: row.amount,
                bankDate: row.date,
                bankTransactionId: bankTx.id,
                matchedByUserId: importedById,
                matchedAt: new Date(),
              },
            });

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
          date: row.date,
          amount: row.amount,
          counterparty: row.counterparty || null,
          ogmCode,
          referenceText: row.reference || null,
          matchStatus,
        },
      });
    }

    for (const regId of completedGiftRegistrationIds) {
      await this.registrationsService.onRegistrationCompleted(regId);
    }

    return this.prisma.bankImport.update({
      where: { id: bankImport.id },
      data: { matchedCount, unmatchedCount },
    });
  }

  private parseCsv(
    csvContent: string,
    preset: BankPreset,
  ): { date: Date; amount: number; counterparty: string; reference: string }[] {
    const lines = csvContent.split(/\r?\n/).filter((l) => l.trim());

    if (preset.id === 'generic') {
      return this.parseGenericCsv(lines);
    }

    // Header-based parsing for bank presets
    const dataLines = lines.slice(preset.skipRows);
    if (dataLines.length < 2) return [];

    const headerLine = dataLines[0];
    const headers = this.splitCsvLine(headerLine, preset.delimiter);
    const rows = dataLines.slice(1);

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
      const date = new Date(dateStr);
      const amount = parseFloat(amountStr.replace(',', '.'));

      if (isNaN(date.getTime()) || isNaN(amount)) continue;

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
