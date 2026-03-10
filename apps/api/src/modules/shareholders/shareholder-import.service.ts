import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { encryptField } from '../../common/crypto';
import * as ExcelJS from 'exceljs';

interface ImportRow {
  type: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  nationalId?: string;
  birthDate?: string;
  companyName?: string;
  companyId?: string;
  vatNumber?: string;
  legalForm?: string;
  street?: string;
  houseNumber?: string;
  postalCode?: string;
  city?: string;
  country?: string;
  bankIban?: string;
  bankBic?: string;
  status?: string;
}

interface RowValidationResult {
  row: number;
  data: ImportRow;
  valid: boolean;
  errors: string[];
}

export interface ImportResult {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  created: number;
  skipped: number;
  errors: Array<{ row: number; errors: string[] }>;
  dryRun: boolean;
}

const EXPECTED_COLUMNS = [
  'type',
  'firstName',
  'lastName',
  'email',
  'phone',
  'nationalId',
  'birthDate',
  'companyName',
  'companyId',
  'vatNumber',
  'legalForm',
  'street',
  'houseNumber',
  'postalCode',
  'city',
  'country',
  'bankIban',
  'bankBic',
  'status',
];

@Injectable()
export class ShareholderImportService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
  ) {}

  async parseFile(file: Express.Multer.File): Promise<ImportRow[]> {
    const ext = file.originalname.toLowerCase().split('.').pop();

    if (ext === 'csv') {
      return this.parseCsv(file.buffer.toString('utf-8'));
    } else if (ext === 'xlsx' || ext === 'xls') {
      return this.parseExcel(file.buffer);
    }

    throw new BadRequestException('Unsupported file format. Please upload a .csv or .xlsx file.');
  }

  private parseCsv(content: string): ImportRow[] {
    const lines = content.split(/\r?\n/).filter((line) => line.trim());
    if (lines.length < 2) {
      throw new BadRequestException('CSV file must contain a header row and at least one data row.');
    }

    const headerLine = lines[0];
    // Support both comma and semicolon delimiters
    const delimiter = headerLine.includes(';') ? ';' : ',';
    const headers = headerLine.split(delimiter).map((h) => h.trim().replace(/^"|"$/g, ''));

    const rows: ImportRow[] = [];
    for (let i = 1; i < lines.length; i++) {
      const values = this.parseCsvLine(lines[i], delimiter);
      const row: Record<string, string> = {};
      headers.forEach((header, idx) => {
        if (values[idx] !== undefined) {
          row[header] = values[idx].trim();
        }
      });
      rows.push(row as unknown as ImportRow);
    }

    return rows;
  }

  private parseCsvLine(line: string, delimiter: string): string[] {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === delimiter && !inQuotes) {
        values.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current);
    return values;
  }

  private async parseExcel(buffer: Buffer): Promise<ImportRow[]> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);

    const worksheet = workbook.worksheets[0];
    if (!worksheet || worksheet.rowCount < 2) {
      throw new BadRequestException('Excel file must contain a header row and at least one data row.');
    }

    const headerRow = worksheet.getRow(1);
    const headers: string[] = [];
    headerRow.eachCell((cell, colNumber) => {
      headers[colNumber - 1] = String(cell.value || '').trim();
    });

    const rows: ImportRow[] = [];
    for (let i = 2; i <= worksheet.rowCount; i++) {
      const excelRow = worksheet.getRow(i);
      // Skip empty rows
      if (!excelRow.hasValues) continue;

      const row: Record<string, string> = {};
      headers.forEach((header, idx) => {
        const cell = excelRow.getCell(idx + 1);
        const value = cell.value;
        if (value !== null && value !== undefined) {
          // Handle date objects from Excel
          if (value instanceof Date) {
            row[header] = value.toISOString().split('T')[0];
          } else {
            row[header] = String(value).trim();
          }
        }
      });
      rows.push(row as unknown as ImportRow);
    }

    return rows;
  }

  validateRows(rows: ImportRow[], existingEmails: Set<string>): RowValidationResult[] {
    const seenEmails = new Set<string>();
    return rows.map((row, index) => {
      const errors: string[] = [];

      // Validate type
      const type = (row.type || '').toUpperCase();
      if (!['INDIVIDUAL', 'COMPANY', 'MINOR'].includes(type)) {
        errors.push(`Invalid type "${row.type}". Must be INDIVIDUAL, COMPANY, or MINOR.`);
      }

      // Validate required fields per type
      if (type === 'INDIVIDUAL' || type === 'MINOR') {
        if (!row.firstName?.trim()) errors.push('firstName is required.');
        if (!row.lastName?.trim()) errors.push('lastName is required.');
      }
      if (type === 'INDIVIDUAL') {
        if (!row.email?.trim()) errors.push('email is required for INDIVIDUAL shareholders.');
      }
      if (type === 'COMPANY') {
        if (!row.companyName?.trim()) errors.push('companyName is required for COMPANY shareholders.');
        if (!row.email?.trim()) errors.push('email is required for COMPANY shareholders.');
      }
      if (type === 'MINOR') {
        if (!row.birthDate?.trim()) errors.push('birthDate is required for MINOR shareholders.');
      }

      // Validate email uniqueness
      if (row.email?.trim()) {
        const email = row.email.trim().toLowerCase();
        if (existingEmails.has(email)) {
          errors.push(`Email "${email}" already exists in this cooperative.`);
        }
        if (seenEmails.has(email)) {
          errors.push(`Duplicate email "${email}" in import file.`);
        }
        seenEmails.add(email);
      }

      // Validate birthDate format if provided
      if (row.birthDate?.trim()) {
        const d = new Date(row.birthDate);
        if (isNaN(d.getTime())) {
          errors.push(`Invalid birthDate "${row.birthDate}". Use YYYY-MM-DD format.`);
        }
      }

      // Validate status if provided
      if (row.status?.trim()) {
        const status = row.status.toUpperCase();
        if (!['PENDING', 'ACTIVE', 'INACTIVE'].includes(status)) {
          errors.push(`Invalid status "${row.status}". Must be PENDING, ACTIVE, or INACTIVE.`);
        }
      }

      return {
        row: index + 2, // +2 because row 1 is header, index is 0-based
        data: { ...row, type },
        valid: errors.length === 0,
        errors,
      };
    });
  }

  async importShareholders(
    coopId: string,
    file: Express.Multer.File,
    dryRun: boolean,
    actorId: string,
    ip?: string,
    userAgent?: string,
  ): Promise<ImportResult> {
    const rows = await this.parseFile(file);

    if (rows.length === 0) {
      throw new BadRequestException('No data rows found in file.');
    }

    if (rows.length > 5000) {
      throw new BadRequestException('Import limited to 5000 rows. Please split the file.');
    }

    // Get existing emails in this coop for uniqueness checks
    const existingShareholders = await this.prisma.shareholder.findMany({
      where: { coopId },
      select: { email: true },
    });
    const existingEmails = new Set(
      existingShareholders.filter((s) => s.email).map((s) => s.email!.toLowerCase()),
    );

    const validated = this.validateRows(rows, existingEmails);
    const validRows = validated.filter((r) => r.valid);
    const invalidRows = validated.filter((r) => !r.valid);

    const result: ImportResult = {
      totalRows: rows.length,
      validRows: validRows.length,
      invalidRows: invalidRows.length,
      created: 0,
      skipped: invalidRows.length,
      errors: invalidRows.map((r) => ({ row: r.row, errors: r.errors })),
      dryRun,
    };

    if (dryRun || validRows.length === 0) {
      return result;
    }

    // Create shareholders in a transaction
    await this.prisma.$transaction(async (tx) => {
      for (const item of validRows) {
        const row = item.data;

        const address =
          row.street || row.houseNumber || row.postalCode || row.city || row.country
            ? {
                street: row.street || '',
                number: row.houseNumber || '',
                postalCode: row.postalCode || '',
                city: row.city || '',
                country: row.country || '',
              }
            : undefined;

        await tx.shareholder.create({
          data: {
            coopId,
            type: row.type as 'INDIVIDUAL' | 'COMPANY' | 'MINOR',
            status: (row.status?.toUpperCase() as 'PENDING' | 'ACTIVE' | 'INACTIVE') || 'ACTIVE',
            firstName: row.firstName?.trim() || null,
            lastName: row.lastName?.trim() || null,
            email: row.email?.trim()?.toLowerCase() || null,
            phone: row.phone?.trim() || null,
            nationalId: row.nationalId?.trim() ? encryptField(row.nationalId.trim()) : null,
            birthDate: row.birthDate ? new Date(row.birthDate) : null,
            companyName: row.companyName?.trim() || null,
            companyId: row.companyId?.trim() || null,
            vatNumber: row.vatNumber?.trim() || null,
            legalForm: row.legalForm?.trim() || null,
            bankIban: row.bankIban?.trim() || null,
            bankBic: row.bankBic?.trim() || null,
            address: address ? JSON.parse(JSON.stringify(address)) : undefined,
          },
        });

        result.created++;
      }
    });

    // Audit log
    await this.auditService.log({
      coopId,
      entity: 'Shareholder',
      entityId: coopId,
      action: 'BULK_IMPORT',
      changes: [
        {
          field: '_bulk_import',
          oldValue: null,
          newValue: `Imported ${result.created} shareholders from ${file.originalname}`,
        },
      ],
      actorId,
      ipAddress: ip,
      userAgent,
    });

    return result;
  }

  getTemplateColumns(): string[] {
    return EXPECTED_COLUMNS;
  }
}
