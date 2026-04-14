import { Test } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { MeetingsService } from './meetings.service';
import { PrismaService } from '../../prisma/prisma.service';

type MeetingMock = {
  findFirst: jest.Mock;
  create: jest.Mock;
  update: jest.Mock;
  delete: jest.Mock;
  findMany: jest.Mock;
};

describe('MeetingsService', () => {
  let service: MeetingsService;
  let prisma: { meeting: MeetingMock };

  beforeEach(async () => {
    prisma = {
      meeting: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        findMany: jest.fn(),
      },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [MeetingsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(MeetingsService);
  });

  it('refuses to delete non-DRAFT meetings', async () => {
    prisma.meeting.findFirst.mockResolvedValue({
      id: 'm1',
      coopId: 'c1',
      status: 'CONVOKED',
    });
    await expect(service.delete('c1', 'm1')).rejects.toThrow(ForbiddenException);
    expect(prisma.meeting.delete).not.toHaveBeenCalled();
  });

  it('deletes DRAFT meetings', async () => {
    prisma.meeting.findFirst.mockResolvedValue({
      id: 'm1',
      coopId: 'c1',
      status: 'DRAFT',
    });
    prisma.meeting.delete.mockResolvedValue({});
    await service.delete('c1', 'm1');
    expect(prisma.meeting.delete).toHaveBeenCalledWith({ where: { id: 'm1' } });
  });
});
