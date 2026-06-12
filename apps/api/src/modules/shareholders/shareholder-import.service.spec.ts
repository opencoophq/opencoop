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
        createMany: jest.fn(),
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
      (prismaService.shareholder.createMany as jest.Mock).mockResolvedValue({ count: 1 });

      const csv = 'type,firstName,lastName,email\nINDIVIDUAL,Jan,Peeters,jan@test.be\n';
      const result = await service.importShareholders('coop-1', makeFile(csv), false, 'user-1');

      expect(result.dryRun).toBe(false);
      expect(result.created).toBe(1);
      // Primary rows are batched into a single createMany; per-row create is not used.
      expect(prismaService.shareholder.createMany).toHaveBeenCalledTimes(1);
      expect(prismaService.shareholder.create).not.toHaveBeenCalled();
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
      (prismaService.shareholder.createMany as jest.Mock).mockResolvedValue({ count: 1 });

      const csv =
        'type,firstName,lastName,email\nINDIVIDUAL,Jan,Peeters,jan@test.be\nINDIVIDUAL,,,\n';
      const result = await service.importShareholders('coop-1', makeFile(csv), false, 'user-1');

      expect(result.created).toBe(1);
      expect(result.invalidRows).toBe(1);
      expect(result.errors).toHaveLength(1);
    });

    it('should encrypt nationalId', async () => {
      (prismaService.shareholder.findMany as jest.Mock).mockResolvedValue([]);
      (prismaService.shareholder.createMany as jest.Mock).mockResolvedValue({ count: 1 });

      const csv =
        'type,firstName,lastName,email,nationalId\nINDIVIDUAL,Jan,Peeters,jan@test.be,85031512345\n';
      const result = await service.importShareholders('coop-1', makeFile(csv), false, 'user-1');

      expect(result.created).toBe(1);
      expect(prismaService.shareholder.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              nationalId: 'encrypted:85031512345',
            }),
          ]),
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
      // Jan (primary) is created via the Pass-1 createMany batch
      (prismaService.shareholder.createMany as jest.Mock).mockResolvedValue({ count: 1 });
      // Marie (linked) is created via per-row create in Pass 2
      (prismaService.shareholder.create as jest.Mock).mockResolvedValue({ id: 'sh-marie', userId: 'user-jan' });
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
      // Jan batched into Pass-1 createMany; Marie created individually in Pass 2.
      expect(prismaService.shareholder.createMany).toHaveBeenCalledTimes(1);
      expect(prismaService.shareholder.create).toHaveBeenCalledTimes(1);
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

    it('rejects linkedTo pointing to a non-existent primary (returns errors, created=0)', async () => {
      // Pre-flight check: findMany returns existing shareholders in coop (none)
      (prismaService.shareholder.findMany as jest.Mock)
        .mockResolvedValueOnce([]) // existing email check for validateRows
        .mockResolvedValueOnce([]); // pre-flight linkedTo DB lookup
      (prismaService.shareholder.create as jest.Mock).mockResolvedValue({ id: 'sh-marie' });

      const csv =
        'type,firstName,lastName,email,linkedTo\n' +
        'INDIVIDUAL,Marie,Janssens,,nobody@x.com\n';

      const result = await service.importShareholders('coop-1', makeFile(csv), false, 'user-admin');

      expect(result.created).toBe(0);
      const allMessages = result.errors.flatMap((e) => e.errors);
      expect(allMessages.some((msg) => /nobody@x\.com/i.test(msg))).toBe(true);
    });

    it('rejects linkedTo target with no user account (row number included, returns errors)', async () => {
      // Pre-flight check: findMany returns existing shareholders (none for email check, then the primary)
      (prismaService.shareholder.findMany as jest.Mock)
        .mockResolvedValueOnce([]) // existing email check
        .mockResolvedValueOnce([{ email: 'primary@x.com', userId: null }]); // pre-flight linkedTo lookup
      (prismaService.shareholder.create as jest.Mock).mockResolvedValue({ id: 'sh-primary' });

      const csv =
        'type,firstName,lastName,email,linkedTo\n' +
        'INDIVIDUAL,Jan,Janssens,jan@x.com,\n' +
        'INDIVIDUAL,Marie,Janssens,,primary@x.com\n';

      const result = await service.importShareholders('coop-1', makeFile(csv), false, 'user-admin');

      expect(result.created).toBe(0);
      const allMessages = result.errors.flatMap((e) => e.errors);
      expect(allMessages.some((msg) => /primary@x\.com/.test(msg) && /no user account/i.test(msg))).toBe(true);
    });
  });

  describe('Pass 1 batching (createMany)', () => {
    const makeFile = (csv: string) =>
      ({
        originalname: 'test.csv',
        buffer: Buffer.from(csv),
      }) as Express.Multer.File;

    it('issues a single createMany for multiple independent primary rows', async () => {
      (prismaService.shareholder.findMany as jest.Mock).mockResolvedValue([]);
      (prismaService.shareholder.createMany as jest.Mock).mockResolvedValue({ count: 3 });

      const csv =
        'type,firstName,lastName,email,companyName\n' +
        'INDIVIDUAL,Jan,Peeters,jan@test.be,\n' +
        'INDIVIDUAL,Marie,Claes,marie@test.be,\n' +
        'COMPANY,,,info@bakkerij.be,Bakkerij BVBA\n';

      const result = await service.importShareholders('coop-1', makeFile(csv), false, 'user-1');

      expect(result.created).toBe(3);
      // A single batched insert for all three primaries.
      expect(prismaService.shareholder.createMany).toHaveBeenCalledTimes(1);
      const callArg = (prismaService.shareholder.createMany as jest.Mock).mock.calls[0][0];
      expect(callArg.data).toHaveLength(3);
      expect(callArg.data.map((d: any) => d.email)).toEqual([
        'jan@test.be',
        'marie@test.be',
        'info@bakkerij.be',
      ]);
      // skipDuplicates must NOT be set — duplicates should still throw/roll back.
      expect(callArg.skipDuplicates).toBeUndefined();
      // Per-row create is never used for primaries.
      expect(prismaService.shareholder.create).not.toHaveBeenCalled();
    });

    it('throws BadRequestException from Pass 2 when an in-flight linkedTo primary is unresolvable at runtime', async () => {
      // existing email check (validateRows) -> none; pre-flight linkedTo lookup -> none.
      // The primary (jan@x.com) is in-flight in this import, so pre-flight defers to runtime.
      (prismaService.shareholder.findMany as jest.Mock)
        .mockResolvedValueOnce([]) // validateRows existing-email check
        .mockResolvedValueOnce([]); // pre-flight linkedTo DB lookup (in-flight primary deferred)
      (prismaService.shareholder.createMany as jest.Mock).mockResolvedValue({ count: 1 });
      // Pass 2 findFirst fails to locate the (mock) primary -> runtime BadRequestException.
      (prismaService.shareholder.findFirst as jest.Mock).mockResolvedValue(null);

      const csv =
        'type,firstName,lastName,email,linkedTo\n' +
        'INDIVIDUAL,Jan,Janssens,jan@x.com,\n' +
        'INDIVIDUAL,Marie,Janssens,,jan@x.com\n';

      await expect(
        service.importShareholders('coop-1', makeFile(csv), false, 'user-admin'),
      ).rejects.toThrow(/Row 3.*jan@x\.com/);
      // Pass 1 still batched the primary before Pass 2 threw.
      expect(prismaService.shareholder.createMany).toHaveBeenCalledTimes(1);
    });
  });
});
