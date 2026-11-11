import { NotFoundException } from '@nestjs/common';
import { AttendanceService } from './attendance.service';

describe('AttendanceService.undo', () => {
  let prisma: any;
  let service: AttendanceService;

  beforeEach(() => {
    prisma = {
      meeting: { findUnique: jest.fn().mockResolvedValue({ coopId: 'c1' }) },
      meetingAttendance: { findUnique: jest.fn(), update: jest.fn() },
    };
    service = new AttendanceService(prisma);
  });

  it('throws NotFound when the shareholder is not on the attendance list', async () => {
    prisma.meetingAttendance.findUnique.mockResolvedValue(null);
    await expect(service.undo('c1', 'm1', 's1')).rejects.toThrow(NotFoundException);
    expect(prisma.meetingAttendance.update).not.toHaveBeenCalled();
  });

  it('clears the check-in of an existing attendance', async () => {
    prisma.meetingAttendance.findUnique.mockResolvedValue({ id: 'a1' });
    prisma.meetingAttendance.update.mockResolvedValue({ id: 'a1' });
    await service.undo('c1', 'm1', 's1');
    expect(prisma.meetingAttendance.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: {
        checkedInAt: null,
        checkedInBy: null,
        checkInMethod: null,
        signatureImageUrl: null,
      },
    });
  });
});
