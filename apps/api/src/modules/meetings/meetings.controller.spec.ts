import { ForbiddenException, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import { MeetingsController } from './meetings.controller';

jest.mock('fs', () => ({
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
}));

jest.mock('./pdf.service', () => ({
  MeetingPdfService: class MeetingPdfService {},
}));

describe('MeetingsController.uploadSignedMinutes', () => {
  const pdf = { buffer: Buffer.from('x'), mimetype: 'application/pdf' } as Express.Multer.File;
  let minutes: { get: jest.Mock; uploadSigned: jest.Mock };
  let controller: MeetingsController;

  beforeEach(() => {
    jest.resetAllMocks();
    minutes = { get: jest.fn(), uploadSigned: jest.fn().mockResolvedValue({ ok: true }) };
    const stub = {} as never;
    controller = new MeetingsController(
      stub,
      stub,
      stub,
      stub,
      stub,
      stub,
      stub,
      minutes as never,
      stub,
      stub,
      stub,
    );
  });

  it('rejects an unknown or traversal id and writes nothing', async () => {
    minutes.get.mockRejectedValue(new NotFoundException('Meeting not found'));
    await expect(
      controller.uploadSignedMinutes('coop-1', '../../../tmp/evil', pdf, 'Jan'),
    ).rejects.toThrow(NotFoundException);
    expect(fs.mkdirSync).not.toHaveBeenCalled();
    expect(fs.writeFileSync).not.toHaveBeenCalled();
    expect(minutes.uploadSigned).not.toHaveBeenCalled();
  });

  it('rejects a meeting from another coop and writes nothing', async () => {
    minutes.get.mockRejectedValue(new ForbiddenException());
    await expect(controller.uploadSignedMinutes('coop-1', 'm-other', pdf, 'Jan')).rejects.toThrow(
      ForbiddenException,
    );
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('rejects a meeting without minutes and writes nothing', async () => {
    minutes.get.mockResolvedValue(null);
    await expect(controller.uploadSignedMinutes('coop-1', 'm-1', pdf, 'Jan')).rejects.toThrow(
      NotFoundException,
    );
    expect(fs.writeFileSync).not.toHaveBeenCalled();
    expect(minutes.uploadSigned).not.toHaveBeenCalled();
  });

  it('writes the file under the verified meeting id', async () => {
    minutes.get.mockResolvedValue({});
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    await controller.uploadSignedMinutes('coop-1', 'm-1', pdf, 'Jan');
    expect(minutes.get).toHaveBeenCalledWith('coop-1', 'm-1');
    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
    const written = (fs.writeFileSync as jest.Mock).mock.calls[0][0] as string;
    expect(written).toContain('minutes/m-1/');
    expect(minutes.uploadSigned).toHaveBeenCalled();
  });
});
