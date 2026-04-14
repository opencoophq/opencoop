jest.mock('../../common/crypto/field-encryption', () => ({
  encryptField: jest.fn((v: string) => `encrypted:${v}`),
  decryptField: jest.fn((v: string) => v.replace('encrypted:', '')),
  isEncrypted: jest.fn((v: string) => v.startsWith('encrypted:')),
}));

process.env.FIELD_ENCRYPTION_KEY = 'a'.repeat(64);

import { ShareholderImportService } from './shareholder-import.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

describe('ShareholderImportService', () => {
  let service: ShareholderImportService;
  let prismaService: PrismaService;
  let auditService: AuditService;

  beforeEach(() => {
    prismaService = {
      shareholder: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
      },
      auditLog: {
        create: jest.fn(),
      },
      $transaction: jest.fn((fn) => fn(prismaService)),
    } as unknown as PrismaService;

    auditService = {
      log: jest.fn(),
    } as unknown as AuditService;

    service = new ShareholderImportService(prismaService, auditService);
  });

  describe('parseCsv (via parseFile)', () => {
    it('should parse a comma-delimited CSV', async () => {
      const csv = 'type,firstName,lastName,email\nINDIVIDUAL,Jan,Peeters,jan@test.be\n';
      const file = {
        originalname: 'test.csv',
        buffer: Buffer.from(csv),
      } as Express.Multer.File;

      const rows = await service.parseFile(file);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        type: 'INDIVIDUAL',
        firstName: 'Jan',
        lastName: 'Peeters',
        email: 'jan@test.be',
      });
    });

    it('should parse a semicolon-delimited CSV', async () => {
      const csv = 'type;firstName;lastName;email\nINDIVIDUAL;Jan;Peeters;jan@test.be\n';
      const file = {
        originalname: 'test.csv',
        buffer: Buffer.from(csv),
      } as Express.Multer.File;

      const rows = await service.parseFile(file);
      expect(rows).toHaveLength(1);
      expect(rows[0].firstName).toBe('Jan');
    });

    it('should handle quoted fields with commas', async () => {
      const csv = 'type,firstName,lastName,email\nCOMPANY,"Bakkerij Janssens, BVBA",,info@bakkerij.be\n';
      const file = {
        originalname: 'test.csv',
        buffer: Buffer.from(csv),
      } as Express.Multer.File;

      const rows = await service.parseFile(file);
      expect(rows[0].firstName).toBe('Bakkerij Janssens, BVBA');
    });

    it('should reject unsupported file formats', async () => {
      const file = {
        originalname: 'test.pdf',
        buffer: Buffer.from('data'),
      } as Express.Multer.File;

      await expect(service.parseFile(file)).rejects.toThrow('Unsupported file format');
    });
  });

  describe('validateRows', () => {
    it('should validate INDIVIDUAL rows correctly', () => {
      const rows = [
        { type: 'INDIVIDUAL', firstName: 'Jan', lastName: 'Peeters', email: 'jan@test.be' },
      ];
      const results = service.validateRows(rows, new Set());
      expect(results[0].valid).toBe(true);
      expect(results[0].errors).toHaveLength(0);
    });

    it('should require firstName and lastName for INDIVIDUAL', () => {
      const rows = [
        { type: 'INDIVIDUAL', email: 'jan@test.be' },
      ];
      const results = service.validateRows(rows, new Set());
      expect(results[0].valid).toBe(false);
      expect(results[0].errors).toContain('firstName is required.');
      expect(results[0].errors).toContain('lastName is required.');
    });

    it('should require email for INDIVIDUAL', () => {
      const rows = [
        { type: 'INDIVIDUAL', firstName: 'Jan', lastName: 'Peeters' },
      ];
      const results = service.validateRows(rows, new Set());
      expect(results[0].valid).toBe(false);
      expect(results[0].errors).toContain('email is required for INDIVIDUAL shareholders.');
    });

    it('should require companyName and email for COMPANY', () => {
      const rows = [{ type: 'COMPANY' }];
      const results = service.validateRows(rows, new Set());
      expect(results[0].valid).toBe(false);
      expect(results[0].errors).toContain('companyName is required for COMPANY shareholders.');
      expect(results[0].errors).toContain('email is required for COMPANY shareholders.');
    });

    it('should require birthDate for MINOR', () => {
      const rows = [
        { type: 'MINOR', firstName: 'Lotte', lastName: 'Peeters' },
      ];
      const results = service.validateRows(rows, new Set());
      expect(results[0].valid).toBe(false);
      expect(results[0].errors).toContain('birthDate is required for MINOR shareholders.');
    });

    it('should reject invalid type', () => {
      const rows = [{ type: 'UNKNOWN' }];
      const results = service.validateRows(rows, new Set());
      expect(results[0].valid).toBe(false);
      expect(results[0].errors[0]).toContain('Invalid type');
    });

    it('should detect duplicate emails in existing data', () => {
      const rows = [
        { type: 'INDIVIDUAL', firstName: 'Jan', lastName: 'Peeters', email: 'jan@test.be' },
      ];
      const existingEmails = new Set(['jan@test.be']);
      const results = service.validateRows(rows, existingEmails);
      expect(results[0].valid).toBe(false);
      expect(results[0].errors[0]).toContain('already exists');
    });

    it('should detect duplicate emails within import file', () => {
      const rows = [
        { type: 'INDIVIDUAL', firstName: 'Jan', lastName: 'Peeters', email: 'jan@test.be' },
        { type: 'INDIVIDUAL', firstName: 'Jan2', lastName: 'Peeters2', email: 'jan@test.be' },
      ];
      const results = service.validateRows(rows, new Set());
      expect(results[0].valid).toBe(true);
      expect(results[1].valid).toBe(false);
      expect(results[1].errors[0]).toContain('Duplicate email');
    });

    it('should reject invalid birthDate format', () => {
      const rows = [
        { type: 'MINOR', firstName: 'Lotte', lastName: 'Peeters', birthDate: 'not-a-date' },
      ];
      const results = service.validateRows(rows, new Set());
      expect(results[0].errors[0]).toContain('Invalid birthDate');
    });

    it('should reject invalid status', () => {
      const rows = [
        { type: 'INDIVIDUAL', firstName: 'Jan', lastName: 'Peeters', email: 'jan@test.be', status: 'DELETED' },
      ];
      const results = service.validateRows(rows, new Set());
      expect(results[0].valid).toBe(false);
      expect(results[0].errors[0]).toContain('Invalid status');
    });

    it('should normalize type to uppercase', () => {
      const rows = [
        { type: 'individual', firstName: 'Jan', lastName: 'Peeters', email: 'jan@test.be' },
      ];
      const results = service.validateRows(rows, new Set());
      expect(results[0].valid).toBe(true);
      expect(results[0].data.type).toBe('INDIVIDUAL');
    });
  });

  describe('importShareholders', () => {
    const makeFile = (csv: string) =>
      ({
        originalname: 'test.csv',
        buffer: Buffer.from(csv),
      }) as Express.Multer.File;

    it('should return dry-run results without creating', async () => {
      (prismaService.shareholder.findMany as jest.Mock).mockResolvedValue([]);

      const csv = 'type,firstName,lastName,email\nINDIVIDUAL,Jan,Peeters,jan@test.be\n';
      const result = await service.importShareholders('coop-1', makeFile(csv), true, 'user-1');

      expect(result.dryRun).toBe(true);
      expect(result.totalRows).toBe(1);
      expect(result.validRows).toBe(1);
      expect(result.created).toBe(0);
      expect(prismaService.shareholder.create).not.toHaveBeenCalled();
    });

    it('should create shareholders when not dry-run', async () => {
      (prismaService.shareholder.findMany as jest.Mock).mockResolvedValue([]);
      (prismaService.shareholder.create as jest.Mock).mockResolvedValue({});

      const csv = 'type,firstName,lastName,email\nINDIVIDUAL,Jan,Peeters,jan@test.be\n';
      const result = await service.importShareholders('coop-1', makeFile(csv), false, 'user-1');

      expect(result.dryRun).toBe(false);
      expect(result.created).toBe(1);
      expect(prismaService.shareholder.create).toHaveBeenCalledTimes(1);
      expect((prismaService as any).auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            coopId: 'coop-1',
            action: 'BULK_IMPORT',
          }),
        }),
      );
    });

    it('should skip invalid rows and create valid ones', async () => {
      (prismaService.shareholder.findMany as jest.Mock).mockResolvedValue([]);
      (prismaService.shareholder.create as jest.Mock).mockResolvedValue({});

      const csv =
        'type,firstName,lastName,email\nINDIVIDUAL,Jan,Peeters,jan@test.be\nINDIVIDUAL,,,\n';
      const result = await service.importShareholders('coop-1', makeFile(csv), false, 'user-1');

      expect(result.created).toBe(1);
      expect(result.invalidRows).toBe(1);
      expect(result.errors).toHaveLength(1);
    });

    it('should encrypt nationalId', async () => {
      (prismaService.shareholder.findMany as jest.Mock).mockResolvedValue([]);
      (prismaService.shareholder.create as jest.Mock).mockResolvedValue({});

      const csv =
        'type,firstName,lastName,email,nationalId\nINDIVIDUAL,Jan,Peeters,jan@test.be,85031512345\n';
      const result = await service.importShareholders('coop-1', makeFile(csv), false, 'user-1');

      expect(result.created).toBe(1);
      expect(prismaService.shareholder.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            nationalId: 'encrypted:85031512345',
          }),
        }),
      );
    });

    it('should reject files with over 5000 rows', async () => {
      const header = 'type,firstName,lastName,email\n';
      const rows = Array(5001)
        .fill('INDIVIDUAL,Jan,Peeters,jan@test.be')
        .join('\n');
      const csv = header + rows;

      (prismaService.shareholder.findMany as jest.Mock).mockResolvedValue([]);

      await expect(
        service.importShareholders('coop-1', makeFile(csv), true, 'user-1'),
      ).rejects.toThrow('5000');
    });
  });

  describe('import with linkedTo column', () => {
    const makeFile = (csv: string) =>
      ({
        originalname: 'test.csv',
        buffer: Buffer.from(csv),
      }) as Express.Multer.File;

    it('accepts duplicate email when second row has linkedTo pointing to first', async () => {
      // No pre-existing shareholders in coop
      (prismaService.shareholder.findMany as jest.Mock).mockResolvedValue([]);
      // Jan is created first (primary); findFirst returns Jan's record (with userId) for Marie's linkedTo resolution
      (prismaService.shareholder.create as jest.Mock).mockResolvedValue({ id: 'sh-jan', userId: 'user-jan' });
      (prismaService.shareholder.findFirst as jest.Mock).mockResolvedValue({
        userId: 'user-jan',
        email: 'jan@x.com',
      });

      const csv =
        'type,firstName,lastName,email,shares,linkedTo\n' +
        'INDIVIDUAL,Jan,Janssens,jan@x.com,10,\n' +
        'INDIVIDUAL,Marie,Janssens,jan@x.com,5,jan@x.com\n';

      const result = await service.importShareholders('coop-1', makeFile(csv), false, 'user-admin');

      expect(result.errors).toHaveLength(0);
      // Jan created as normal, Marie created with email=null and userId=primary's userId
      expect(prismaService.shareholder.create).toHaveBeenCalledTimes(2);
      // Marie's create call should have email: null and userId: 'user-jan'
      const createCalls = (prismaService.shareholder.create as jest.Mock).mock.calls;
      const marieCall = createCalls.find((call) => call[0]?.data?.userId === 'user-jan');
      expect(marieCall).toBeDefined();
      expect(marieCall[0].data.email).toBeNull();
    });

    it('still rejects duplicate email when no linkedTo column', async () => {
      (prismaService.shareholder.findMany as jest.Mock).mockResolvedValue([]);

      const csv =
        'type,firstName,lastName,email\n' +
        'INDIVIDUAL,Jan,Janssens,jan@x.com\n' +
        'INDIVIDUAL,Piet,Janssens,jan@x.com\n';

      const result = await service.importShareholders('coop-1', makeFile(csv), true, 'user-admin');

      expect(result.errors.length).toBeGreaterThan(0);
      const errorMessages = result.errors.flatMap((e) => e.errors);
      expect(errorMessages.some((msg) => msg.toLowerCase().includes('duplicate') || msg.toLowerCase().includes('already exists'))).toBe(true);
    });

    it('rejects linkedTo pointing to a non-existent primary', async () => {
      (prismaService.shareholder.findMany as jest.Mock).mockResolvedValue([]);
      (prismaService.shareholder.create as jest.Mock).mockResolvedValue({ id: 'sh-marie' });
      // findFirst returns null — primary not found
      (prismaService.shareholder.findFirst as jest.Mock).mockResolvedValue(null);

      const csv =
        'type,firstName,lastName,email,linkedTo\n' +
        'INDIVIDUAL,Marie,Janssens,,nobody@x.com\n';

      await expect(
        service.importShareholders('coop-1', makeFile(csv), false, 'user-admin'),
      ).rejects.toThrow(/linkedTo.*nobody@x\.com|nobody@x\.com.*not found/i);
    });
  });
});
