import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { HouseholdService } from './household.service';
import { EmancipationService } from '../auth/emancipation.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('HouseholdService', () => {
  let service: HouseholdService;
  let prisma: any;
  let emancipationService: any;

  beforeEach(async () => {
    prisma = {
      shareholder: {
        findFirst: jest.fn(),
      },
    };

    emancipationService = {
      startEmancipation: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HouseholdService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmancipationService, useValue: emancipationService },
      ],
    }).compile();

    service = module.get<HouseholdService>(HouseholdService);
  });

  describe('unlinkShareholder', () => {
    it('delegates to emancipationService.startEmancipation with HOUSEHOLD_SPLIT reason', async () => {
      prisma.shareholder.findFirst.mockResolvedValue({ id: 'sh1', coopId: 'coop1' });
      const fakeToken = { id: 'tok1', token: 'abc', shareholderId: 'sh1' };
      emancipationService.startEmancipation.mockResolvedValue(fakeToken);

      const result = await service.unlinkShareholder('coop1', 'sh1');

      expect(emancipationService.startEmancipation).toHaveBeenCalledWith({
        shareholderId: 'sh1',
        reason: 'HOUSEHOLD_SPLIT',
      });
      expect(result).toEqual(fakeToken);
    });

    it('throws NotFoundException if shareholder does not belong to the coop', async () => {
      prisma.shareholder.findFirst.mockResolvedValue(null);

      await expect(service.unlinkShareholder('coop1', 'sh-other')).rejects.toThrow(NotFoundException);
    });
  });
});
