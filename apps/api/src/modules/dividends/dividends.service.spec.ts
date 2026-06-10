import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { DividendsService } from './dividends.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

describe('DividendsService tenant isolation', () => {
  let service: DividendsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      dividendPeriod: { findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
      dividendPayout: { findMany: jest.fn(), deleteMany: jest.fn(), createMany: jest.fn() },
      registration: { findMany: jest.fn() },
    };
    const mod = await Test.createTestingModule({
      providers: [
        DividendsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: { log: jest.fn() } },
      ],
    }).compile();
    service = mod.get(DividendsService);
  });

  it('findById scopes by coopId and 404s a foreign period', async () => {
    prisma.dividendPeriod.findFirst.mockResolvedValue(null);
    await expect(service.findById('period-B', 'coop-A')).rejects.toThrow(NotFoundException);
    expect(prisma.dividendPeriod.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'period-B', coopId: 'coop-A' }) }),
    );
  });

  it('calculate scopes by coopId and 404s a foreign period', async () => {
    prisma.dividendPeriod.findFirst.mockResolvedValue(null);
    await expect(service.calculate('period-B', 'coop-A')).rejects.toThrow(NotFoundException);
    expect(prisma.dividendPeriod.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'period-B', coopId: 'coop-A' }) }),
    );
  });

  it('markAsPaid scopes by coopId and 404s a foreign period', async () => {
    prisma.dividendPeriod.findFirst.mockResolvedValue(null);
    await expect(service.markAsPaid('period-B', 'coop-A')).rejects.toThrow(NotFoundException);
    expect(prisma.dividendPeriod.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'period-B', coopId: 'coop-A' }) }),
    );
  });

  it('exportToCsv scopes by coopId and 404s a foreign period', async () => {
    prisma.dividendPeriod.findFirst.mockResolvedValue(null);
    await expect(service.exportToCsv('period-B', 'coop-A')).rejects.toThrow(NotFoundException);
    expect(prisma.dividendPeriod.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'period-B', coopId: 'coop-A' }) }),
    );
  });
});

describe('DividendsService.calculate — period-level tax rounding reconciliation', () => {
  let service: DividendsService;
  let prisma: any;

  // Period at 1% dividend rate, 30% withholding.
  const period = {
    id: 'period-1',
    coopId: 'coop-1',
    status: 'DRAFT',
    name: '2025 dividend',
    year: 2025,
    dividendRate: 0.01,
    withholdingTaxRate: 0.3,
    exDividendDate: new Date('2025-12-31'),
    paymentDate: null,
  };

  // 3 shareholders, each with one BUY registration that vests to a gross of 10.01:
  //   pricePerShare 1, vested 1001 shares, shareValue 1001, * 0.01 rate = 10.01 gross.
  // Naive per-payout rounding of 10.01 * 0.3 = 3.003 -> 3.00 each, sum 9.00.
  // Period target round(30.03 * 0.3) = round(9.009) = 9.01 -> apportionment must add 1 cent.
  function makeReg(shareholderId: string) {
    return {
      shareholderId,
      shareClassId: 'sc-1',
      pricePerShare: 1,
      quantity: 1001,
      shareClass: { id: 'sc-1', name: 'A', dividendRateOverride: null },
      payments: [{ amount: 1001, bankDate: new Date('2025-01-01') }],
    };
  }

  beforeEach(async () => {
    prisma = {
      dividendPeriod: {
        findFirst: jest.fn().mockResolvedValue(period),
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      dividendPayout: {
        findMany: jest.fn(),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 3 }),
      },
      registration: {
        findMany: jest.fn().mockResolvedValue([makeReg('sh-1'), makeReg('sh-2'), makeReg('sh-3')]),
      },
    };
    const mod = await Test.createTestingModule({
      providers: [
        DividendsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: { log: jest.fn() } },
      ],
    }).compile();
    service = mod.get(DividendsService);
    // Stub the trailing findById (which re-queries findFirst) so calculate returns cleanly.
    jest.spyOn(service, 'findById').mockResolvedValue({ id: period.id } as any);
  });

  it('apportions withholding tax so payouts reconcile to round(totalGross * rate) and stay whole-cent', async () => {
    await service.calculate('period-1', 'coop-1');

    expect(prisma.dividendPayout.createMany).toHaveBeenCalledTimes(1);
    const created = prisma.dividendPayout.createMany.mock.calls[0][0].data;
    expect(created).toHaveLength(3);

    const totalGross = created.reduce((s: number, p: any) => s + p.grossAmount, 0);
    const sumTax = Math.round(created.reduce((s: number, p: any) => s + p.withholdingTax, 0) * 100) / 100;

    // Period-level invariant: per-payout taxes sum exactly to the rounded period target.
    expect(sumTax).toBe(Math.round(totalGross * 0.3 * 100) / 100);
    // Sanity: drift case — naive would give 9.00, correct apportioned total is 9.01.
    expect(sumTax).toBe(9.01);

    created.forEach((p: any) => {
      // tax is whole cents
      expect(Math.round(p.withholdingTax * 100)).toBeCloseTo(p.withholdingTax * 100, 6);
      // gross - tax - net reconciles to 0 cents (net is whole cents too)
      expect(Math.round((p.grossAmount - p.withholdingTax - p.netAmount) * 100)).toBe(0);
    });
  });
});
