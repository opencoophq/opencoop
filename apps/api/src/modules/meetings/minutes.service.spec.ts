import { NotFoundException } from '@nestjs/common';
import { MinutesService } from './minutes.service';

describe('MinutesService without minutes', () => {
  let prisma: any;
  let service: MinutesService;

  beforeEach(() => {
    prisma = {
      meeting: { findUnique: jest.fn().mockResolvedValue({ coopId: 'c1' }) },
      meetingMinutes: { findUnique: jest.fn().mockResolvedValue(null), update: jest.fn() },
    };
    service = new MinutesService(prisma);
  });

  it.each([
    ['update', () => service.update('c1', 'm1', 'text')],
    ['finalize', () => service.finalize('c1', 'm1', '')],
    ['uploadSigned', () => service.uploadSigned('c1', 'm1', '/u.pdf', 'Jan')],
  ])('%s throws NotFound when no minutes exist yet', async (_name, call) => {
    await expect(call()).rejects.toThrow(NotFoundException);
    expect(prisma.meetingMinutes.update).not.toHaveBeenCalled();
  });

  it('update still writes when minutes exist', async () => {
    prisma.meetingMinutes.findUnique.mockResolvedValue({ meetingId: 'm1' });
    prisma.meetingMinutes.update.mockResolvedValue({});
    await service.update('c1', 'm1', 'text');
    expect(prisma.meetingMinutes.update).toHaveBeenCalledWith({
      where: { meetingId: 'm1' },
      data: { content: 'text' },
    });
  });
});
