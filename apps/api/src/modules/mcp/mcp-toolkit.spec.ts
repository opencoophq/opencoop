import {
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, MinLength, ValidateNested } from 'class-validator';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { Prisma } from '@opencoop/database';
import { Decimal } from '@prisma/client/runtime/library';
import { BillingService } from '../billing/billing.service';
import { AuditService } from '../audit/audit.service';
import { CoopPermissionsService } from '../../common/utils/coop-permissions';
import { PrismaService } from '../../prisma/prisma.service';
import { McpAuthStore } from './mcp-auth.store';
import { McpToolkit } from './mcp-toolkit';

class NestedDto {
  @MinLength(3, { message: 'nested label is too short' })
  label: string;
}

class TestDto {
  @IsInt()
  count: number;

  @ValidateNested()
  @Type(() => NestedDto)
  child: NestedDto;
}

describe('McpToolkit', () => {
  const auth = {
    getUserId: jest.fn(),
    getCoopId: jest.fn(),
    getApiKeyId: jest.fn(),
    getScope: jest.fn(),
  };
  const permissionService = {
    permissions: jest.fn(),
    permissionsWithRole: jest.fn(),
  };
  const billingService = {
    isReadOnly: jest.fn(),
  };

  let toolkit: McpToolkit;
  let loggerError: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    auth.getUserId.mockReturnValue('user1');
    auth.getCoopId.mockReturnValue('coop1');
    auth.getApiKeyId.mockReturnValue('key1');
    auth.getScope.mockReturnValue('READ_WRITE');
    permissionService.permissions.mockResolvedValue({
      canManageShareholders: true,
      canViewPII: true,
    });
    permissionService.permissionsWithRole.mockImplementation(async (userId, coopId) => ({
      permissions: await permissionService.permissions(userId, coopId),
      role: 'COOP_ADMIN',
    }));
    billingService.isReadOnly.mockResolvedValue(false);
    loggerError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    toolkit = new McpToolkit(
      auth as unknown as McpAuthStore,
      permissionService as unknown as CoopPermissionsService,
      billingService as unknown as BillingService,
    );
  });

  afterEach(() => {
    loggerError.mockRestore();
  });

  async function expectMcpError(promise: Promise<unknown>): Promise<McpError> {
    try {
      await promise;
      throw new Error('Expected McpError');
    } catch (error) {
      expect(error).toBeInstanceOf(McpError);
      return error as McpError;
    }
  }

  it('builds context from live permissions with one permission lookup', async () => {
    const fn = jest.fn(async (ctx) => ({ ctx }));

    const result = await toolkit.run({ permission: 'canManageShareholders' }, undefined, fn);

    expect(permissionService.permissions).toHaveBeenCalledTimes(1);
    expect(permissionService.permissions).toHaveBeenCalledWith('user1', 'coop1');
    expect(fn).toHaveBeenCalledWith(
      {
        userId: 'user1',
        coopId: 'coop1',
        apiKeyId: 'key1',
        scope: 'READ_WRITE',
        canViewPII: true,
        audit: {
          userId: 'user1',
          ip: 'mcp',
          userAgent: 'mcp-api-key:key1',
        },
      },
      undefined,
    );
    expect(result).toEqual({ ctx: expect.objectContaining({ canViewPII: true }) });
  });

  it('refuses a missing live permission', async () => {
    permissionService.permissions.mockResolvedValue({ canViewPII: true });
    const fn = jest.fn();

    const error = await expectMcpError(
      toolkit.run({ permission: 'canManageShareholders' }, undefined, fn),
    );

    expect(error.code).toBe(ErrorCode.InvalidParams);
    expect(error.message).toBe('Insufficient permissions');
    expect(fn).not.toHaveBeenCalled();
  });

  it('refuses a write through a read-only API key', async () => {
    auth.getScope.mockReturnValue('READ_ONLY');

    const error = await expectMcpError(
      toolkit.run({ write: true }, undefined, async () => ({ ok: true })),
    );

    expect(error.code).toBe(ErrorCode.InvalidParams);
    expect(error.message).toBe('This API key is read-only');
    expect(billingService.isReadOnly).not.toHaveBeenCalled();
  });

  it('refuses a write when the subscription is read-only', async () => {
    billingService.isReadOnly.mockResolvedValue(true);

    const error = await expectMcpError(
      toolkit.run({ write: true }, undefined, async () => ({ ok: true })),
    );

    expect(error.code).toBe(ErrorCode.InvalidParams);
    expect(error.message).toBe('Your subscription has expired. Please subscribe to continue.');
  });

  it('transforms and validates a DTO with implicit conversion', async () => {
    const fn = jest.fn(async (_ctx, dto: TestDto) => ({ count: dto.count }));

    const result = await toolkit.run(
      { dto: TestDto },
      { count: '7', child: { label: 'valid' } },
      fn,
    );

    expect(fn.mock.calls[0][1]).toBeInstanceOf(TestDto);
    expect(fn.mock.calls[0][1].child).toBeInstanceOf(NestedDto);
    expect(result).toEqual({ count: 7 });
  });

  it('flattens nested DTO validation messages', async () => {
    const fn = jest.fn();

    const error = await expectMcpError(
      toolkit.run({ dto: TestDto }, { count: 'invalid', child: { label: 'x' }, extra: true }, fn),
    );

    expect(error.code).toBe(ErrorCode.InvalidParams);
    expect(error.message).toContain('count must be an integer number');
    expect(error.message).toContain('nested label is too short');
    expect(error.message).toContain('property extra should not exist');
    expect(fn).not.toHaveBeenCalled();
  });

  it('masks a shareholder-like object with the shared masker and extra fields', async () => {
    permissionService.permissions.mockResolvedValue({ canViewPII: false });

    const result = await toolkit.run({}, undefined, async () => ({
      id: 'shareholder-1234',
      type: 'INDIVIDUAL',
      name: 'Ada Lovelace',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      phone: '+3212345678',
      address: { street: 'Main Street' },
      city: 'Brussels',
      postalCode: '1000',
      companyName: null,
      companyId: null,
      bankIban: 'BE123',
      bankBic: 'BIC123',
      birthDate: '1990-01-01',
      street: 'Main Street',
      houseNumber: '42',
      nationalId: 'secret',
    }));

    expect(result).toEqual({
      id: 'shareholder-1234',
      type: 'INDIVIDUAL',
      name: 'Aandeelhouder #1234',
      firstName: 'Aandeelhouder #1234',
      lastName: '',
      email: '***',
      phone: '***',
      address: '***',
      city: '***',
      postalCode: '***',
      companyName: null,
      companyId: null,
      bankIban: '***',
      bankBic: '***',
      birthDate: '***',
      street: '***',
      houseNumber: '***',
      nationalId: '***',
    });
  });

  it('masks shareholder-like objects recursively inside another object', async () => {
    permissionService.permissions.mockResolvedValue({ canViewPII: false });

    const result = await toolkit.run({}, undefined, async () => ({
      registration: {
        id: 'registration-1',
        shareholder: {
          id: 'shareholder-5678',
          firstName: 'Grace',
          email: 'grace@example.com',
          profile: { email: 'nested@example.com' },
        },
      },
    }));

    expect(result).toEqual({
      registration: {
        id: 'registration-1',
        shareholder: expect.objectContaining({
          firstName: 'Aandeelhouder #5678',
          email: '***',
          profile: { email: '***' },
        }),
      },
    });
  });

  it('normalises falsy shareholder-only PII fields to null', async () => {
    permissionService.permissions.mockResolvedValue({ canViewPII: false });

    const result = await toolkit.run({}, undefined, async () => ({
      id: 'shareholder-1234',
      firstName: 'Ada',
      bankIban: '',
      bankBic: undefined,
      birthDate: null,
      street: '',
      houseNumber: null,
      nationalId: '',
    }));

    expect(result).toEqual(
      expect.objectContaining({
        bankIban: null,
        bankBic: null,
        birthDate: null,
        street: null,
        houseNumber: null,
        nationalId: null,
      }),
    );
  });

  it('masks flat PII keys on non-shareholder-like objects and preserves falsy values', async () => {
    permissionService.permissions.mockResolvedValue({ canViewPII: false });

    const result = await toolkit.run({}, undefined, async () => ({
      email: 'registration@example.com',
      shareholderEmail: 'shareholder@example.com',
      phone: null,
      bankIban: 'BE123',
      bankBic: '',
      birthDate: '1990-01-01',
      address: { street: 'Main Street' },
      street: 'Main Street',
      houseNumber: '42',
      postalCode: '1000',
      city: 'Brussels',
    }));

    expect(result).toEqual({
      email: '***',
      shareholderEmail: '***',
      phone: null,
      bankIban: '***',
      bankBic: '',
      birthDate: '***',
      address: '***',
      street: '***',
      houseNumber: '***',
      postalCode: '***',
      city: '***',
    });
  });

  it('masks PII audit changes from the JSON shape returned by AuditService.findByCoop', async () => {
    permissionService.permissions.mockResolvedValue({ canViewPII: false });
    const auditPrisma = {
      auditLog: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'audit-1',
            changes: [
              {
                field: 'email',
                oldValue: null,
                newValue: { primary: 'ada@example.com' },
              },
              { field: 'status', oldValue: 'PENDING', newValue: 'ACTIVE' },
            ],
          },
        ]),
        count: jest.fn().mockResolvedValue(1),
      },
    };
    const auditService = new AuditService(auditPrisma as unknown as PrismaService);
    const auditLogs = await auditService.findByCoop('coop1');

    const result = await toolkit.run({}, undefined, async () => auditLogs);

    expect(result).toEqual({
      items: [
        {
          id: 'audit-1',
          changes: [
            { field: 'email', oldValue: '***', newValue: '***' },
            { field: 'status', oldValue: 'PENDING', newValue: 'ACTIVE' },
          ],
        },
      ],
      total: 1,
      page: 1,
      limit: 50,
      totalPages: 1,
    });
  });

  it('keeps coop and project names and coop contact fields visible', async () => {
    permissionService.permissions.mockResolvedValue({ canViewPII: false });

    const result = await toolkit.run({}, undefined, async () => ({
      coop: {
        id: 'coop-1',
        name: 'Open Coop',
        coopEmail: 'hello@coop.example',
        coopPhone: '+3212345678',
      },
      project: { id: 'project-1', name: 'Solar Roof' },
    }));

    expect(result).toEqual({
      coop: {
        id: 'coop-1',
        name: 'Open Coop',
        coopEmail: 'hello@coop.example',
        coopPhone: '+3212345678',
      },
      project: { id: 'project-1', name: 'Solar Roof' },
    });
  });

  it('uses stable sibling-id labels for name-bearing flat keys', async () => {
    permissionService.permissions.mockResolvedValue({ canViewPII: false });
    const source = {
      first: { shareholderId: 'shareholder-1234', shareholderName: 'Ada Lovelace' },
      second: { shareholderId: 'shareholder-1234', fullName: 'Ada Lovelace' },
      missingId: { shareholderName: 'Unknown' },
    };

    const firstRun = await toolkit.run({}, undefined, async () => source);
    const secondRun = await toolkit.run({}, undefined, async () => source);

    expect(firstRun).toEqual({
      first: { shareholderId: 'shareholder-1234', shareholderName: 'Aandeelhouder #1234' },
      second: { shareholderId: 'shareholder-1234', fullName: 'Aandeelhouder #1234' },
      missingId: { shareholderName: '***' },
    });
    expect(secondRun).toEqual(firstRun);
  });

  it('masks bank and counterparty PII keys including beneficiary names', async () => {
    permissionService.permissions.mockResolvedValue({ canViewPII: false });

    const result = await toolkit.run({}, undefined, async () => ({
      payment: {
        iban: 'BE123',
        bic: 'BIC123',
        counterparty: 'Ada Lovelace',
        counterpartyName: 'Ada Lovelace',
        counterpartyIban: 'BE456',
        accountHolder: 'Ada Lovelace',
        beneficiaryName: 'Ada Lovelace',
      },
      shareholderPayment: {
        shareholderId: 'shareholder-1234',
        beneficiaryName: 'Ada Lovelace',
      },
    }));

    expect(result).toEqual({
      payment: {
        iban: '***',
        bic: '***',
        counterparty: '***',
        counterpartyName: '***',
        counterpartyIban: '***',
        accountHolder: '***',
        beneficiaryName: '***',
      },
      shareholderPayment: {
        shareholderId: 'shareholder-1234',
        beneficiaryName: 'Aandeelhouder #1234',
      },
    });
  });

  it('keeps bank details on a top-level coop record while masking shareholder bank details', async () => {
    permissionService.permissions.mockResolvedValue({ canViewPII: false });

    const result = await toolkit.run({}, undefined, async () => ({
      slug: 'open-coop',
      bankIban: 'BE123',
      bankBic: 'BIC123',
      shareholder: {
        id: 'shareholder-5678',
        firstName: 'Grace',
        bankIban: 'BE456',
        bankBic: 'BIC456',
      },
    }));

    expect(result).toEqual({
      slug: 'open-coop',
      bankIban: 'BE123',
      bankBic: 'BIC123',
      shareholder: expect.objectContaining({ bankIban: '***', bankBic: '***' }),
    });
  });

  it('masks signer, IP address, and user-projection names', async () => {
    permissionService.permissions.mockResolvedValue({ canViewPII: false });

    const result = await toolkit.run({}, undefined, async () => ({
      signedByName: 'Ada Lovelace',
      ipAddress: '192.0.2.1',
      actor: { id: 'user-1', name: 'Ada Lovelace', email: 'ada@example.com' },
      project: { id: 'project-1', name: 'Solar Roof' },
    }));

    expect(result).toEqual({
      signedByName: '***',
      ipAddress: '***',
      actor: { id: 'user-1', name: '***', email: '***' },
      project: { id: 'project-1', name: 'Solar Roof' },
    });
  });

  it('keeps PII visible when canViewPII is true', async () => {
    const source = {
      shareholder: {
        id: 'shareholder-1234',
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@example.com',
      },
      audit: {
        field: 'email',
        oldValue: 'old@example.com',
        newValue: 'new@example.com',
      },
      summary: { shareholderId: 'shareholder-1234', shareholderName: 'Ada Lovelace' },
    };

    await expect(toolkit.run({}, undefined, async () => source)).resolves.toEqual(source);
  });

  it('keeps PII visible when canViewPII is absent and masks only explicit false', async () => {
    permissionService.permissionsWithRole.mockResolvedValue({
      permissions: {},
      role: 'COOP_ADMIN',
    });

    const visible = await toolkit.run({}, undefined, async () => ({
      id: 'shareholder-1234',
      firstName: 'Ada',
      email: 'ada@example.com',
    }));
    expect(visible).toEqual({
      id: 'shareholder-1234',
      firstName: 'Ada',
      email: 'ada@example.com',
    });

    permissionService.permissionsWithRole.mockResolvedValue({
      permissions: { canViewPII: false },
      role: 'COOP_ADMIN',
    });
    const masked = await toolkit.run({}, undefined, async () => ({
      id: 'shareholder-1234',
      firstName: 'Ada',
      email: 'ada@example.com',
    }));
    expect(masked).toEqual(
      expect.objectContaining({ firstName: 'Aandeelhouder #1234', email: '***' }),
    );
  });

  it('uses the REST legacy default for missing permissions', async () => {
    permissionService.permissionsWithRole.mockResolvedValue({
      permissions: {},
      role: 'COOP_ADMIN',
    });

    await expect(
      toolkit.run({ permission: 'canManageMeetings' }, undefined, async () => ({ ok: true })),
    ).resolves.toEqual({ ok: true });
    await expect(
      toolkit.run({ permission: 'canViewReports' }, undefined, async () => ({ ok: true })),
    ).rejects.toMatchObject({ message: 'Insufficient permissions' });
  });

  it('allows SYSTEM_ADMIN write tools during read-only subscriptions', async () => {
    permissionService.permissionsWithRole.mockResolvedValue({
      permissions: {},
      role: 'SYSTEM_ADMIN',
    });
    billingService.isReadOnly.mockResolvedValue(true);

    await expect(
      toolkit.run({ write: true }, undefined, async () => ({ ok: true })),
    ).resolves.toEqual({ ok: true });
  });

  it('normalises values recursively without mutating the source', async () => {
    const createdAt = new Date('2026-09-24T10:00:00.000Z');
    const source = {
      amount: new Decimal('12.34'),
      createdAt,
      nationalId: 'secret',
      nested: {
        giftCode: 'gift',
        values: [
          {
            amount: new Decimal('2.5'),
            filePath: '/secret/file',
            keyHash: 'hash',
            passwordHash: 'password',
            safeBigInt: 42n,
            unsafeBigInt: BigInt(Number.MAX_SAFE_INTEGER) + 1n,
          },
        ],
      },
    };

    const result = await toolkit.run({}, undefined, async () => source);

    expect(result).toEqual({
      amount: 12.34,
      createdAt: '2026-09-24T10:00:00.000Z',
      nested: {
        values: [
          {
            amount: 2.5,
            safeBigInt: 42,
            unsafeBigInt: '9007199254740992',
          },
        ],
      },
    });
    expect(source.amount).toBeInstanceOf(Decimal);
    expect(source.createdAt).toBe(createdAt);
    expect(source.nationalId).toBe('secret');
    expect(source.nested.values[0].filePath).toBe('/secret/file');
  });

  it('breaks cycles and keeps bare arrays single-encoded', async () => {
    const source: Record<string, unknown> = { value: 1 };
    source.self = source;

    const cycleResult = await toolkit.run({}, undefined, async () => source);
    const arrayResult = await toolkit.run({}, undefined, async () => [source]);

    expect(cycleResult).toEqual({ value: 1, self: '[Circular]' });
    expect(arrayResult).toEqual([{ value: 1, self: '[Circular]' }]);
  });

  it('wraps a top-level primitive result', async () => {
    await expect(toolkit.run({}, undefined, async () => 'ok')).resolves.toEqual({ result: 'ok' });
  });

  it.each([
    [new BadRequestException('bad input'), ErrorCode.InvalidParams, 'bad input'],
    [new ForbiddenException('forbidden'), ErrorCode.InvalidParams, 'forbidden'],
    [new InternalServerErrorException('server failed'), ErrorCode.InvalidRequest, 'server failed'],
  ])('maps HttpException errors', async (sourceError, code, message) => {
    const error = await expectMcpError(
      toolkit.run({}, undefined, async () => {
        throw sourceError;
      }),
    );

    expect(error.code).toBe(code);
    expect(error.message).toBe(message);
  });

  it.each([
    ['P2025', 'Not found'],
    ['P2002', 'Already exists (duplicate)'],
    ['P2003', 'Invalid input'],
  ])('maps Prisma known error %s', async (code, message) => {
    const sourceError = new Prisma.PrismaClientKnownRequestError('database detail', {
      code,
      clientVersion: 'test',
    });

    const error = await expectMcpError(
      toolkit.run({}, undefined, async () => {
        throw sourceError;
      }),
    );

    expect(error.code).toBe(ErrorCode.InvalidParams);
    expect(error.message).toBe(message);
  });

  it('maps Prisma validation errors without leaking details', async () => {
    const sourceError = new Prisma.PrismaClientValidationError('database detail', {
      clientVersion: 'test',
    });

    const error = await expectMcpError(
      toolkit.run({}, undefined, async () => {
        throw sourceError;
      }),
    );

    expect(error.code).toBe(ErrorCode.InvalidParams);
    expect(error.message).toBe('Invalid input');
  });

  it('logs unknown errors and hides their details', async () => {
    const sourceError = new Error('secret internal detail');

    const error = await expectMcpError(
      toolkit.run({}, undefined, async () => {
        throw sourceError;
      }),
    );

    expect(loggerError).toHaveBeenCalledWith(sourceError);
    expect(error.code).toBe(ErrorCode.InternalError);
    expect(error.message).toBe('Internal error');
  });
});
