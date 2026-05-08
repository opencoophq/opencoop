import { Test } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { MeetingDocumentsService } from './meeting-documents.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';

describe('MeetingDocumentsService', () => {
  let service: MeetingDocumentsService;
  let emailService: { queueDocumentsEmail: jest.Mock };
  let prisma: {
    meeting: { findUnique: jest.Mock; update: jest.Mock };
    meetingDocument: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
      aggregate: jest.Mock;
    };
    meetingAttendance: {
      count: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    shareholder: { findUnique: jest.Mock };
  };
  let tmpUploadDir: string;
  const ORIGINAL_UPLOAD_DIR = process.env.UPLOAD_DIR;

  beforeEach(async () => {
    tmpUploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencoop-test-'));
    process.env.UPLOAD_DIR = tmpUploadDir;

    emailService = { queueDocumentsEmail: jest.fn().mockResolvedValue(undefined) };

    const configService = {
      get: jest.fn().mockImplementation((k: string) => {
        if (k === 'PUBLIC_URL') return 'https://opencoop.be';
        if (k === 'API_PUBLIC_URL') return 'https://opencoop.be/api';
        return null;
      }),
    };

    prisma = {
      meeting: { findUnique: jest.fn(), update: jest.fn() },
      meetingDocument: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        aggregate: jest.fn(),
      },
      meetingAttendance: {
        count: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      shareholder: { findUnique: jest.fn() },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        MeetingDocumentsService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailService, useValue: emailService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();
    service = moduleRef.get(MeetingDocumentsService);
  });

  afterEach(() => {
    fs.rmSync(tmpUploadDir, { recursive: true, force: true });
    process.env.UPLOAD_DIR = ORIGINAL_UPLOAD_DIR;
  });

  describe('upload', () => {
    const meeting = { id: 'm1', coopId: 'c1' };
    const file = {
      buffer: Buffer.from('%PDF-1.4 fake'),
      mimetype: 'application/pdf',
      originalname: 'Jaarverslag 2025.pdf',
      size: 12,
    } as Express.Multer.File;

    it('creates a new document for first upload', async () => {
      prisma.meeting.findUnique.mockResolvedValue(meeting);
      prisma.meetingDocument.findFirst.mockResolvedValue(null);
      prisma.meetingDocument.aggregate.mockResolvedValue({ _max: { order: null } });
      prisma.meetingDocument.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'd1', ...data }),
      );

      const result = await service.upload('c1', 'm1', file, undefined, 'admin1');

      expect(result.id).toBe('d1');
      expect(result.fileName).toBe('Jaarverslag 2025.pdf');
      expect(prisma.meetingDocument.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          meetingId: 'm1',
          fileName: 'Jaarverslag 2025.pdf',
          fileSize: 12,
          order: 0,
          uploadedBy: 'admin1',
        }),
      });
      // Disk file written
      const writtenPath = (prisma.meetingDocument.create as jest.Mock).mock.calls[0][0].data.fileUrl;
      expect(fs.existsSync(path.join(tmpUploadDir, writtenPath))).toBe(true);
    });

    it('rejects non-PDF mimetype', async () => {
      const bad = { ...file, mimetype: 'image/png' } as Express.Multer.File;
      await expect(service.upload('c1', 'm1', bad, undefined, 'admin1')).rejects.toThrow(BadRequestException);
    });

    it('accepts xlsx files', async () => {
      prisma.meeting.findUnique.mockResolvedValue(meeting);
      prisma.meetingDocument.findFirst.mockResolvedValue(null);
      prisma.meetingDocument.aggregate.mockResolvedValue({ _max: { order: null } });
      prisma.meetingDocument.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'd2', ...data }),
      );
      const xlsx = {
        ...file,
        mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        originalname: 'Jaarrekening.xlsx',
      } as Express.Multer.File;

      await service.upload('c1', 'm1', xlsx, undefined, 'admin1');

      const fileUrl = (prisma.meetingDocument.create as jest.Mock).mock.calls[0][0].data.fileUrl;
      expect(fileUrl).toMatch(/\.xlsx$/);
      expect(fs.existsSync(path.join(tmpUploadDir, fileUrl))).toBe(true);
    });

    it('accepts legacy .xls files', async () => {
      prisma.meeting.findUnique.mockResolvedValue(meeting);
      prisma.meetingDocument.findFirst.mockResolvedValue(null);
      prisma.meetingDocument.aggregate.mockResolvedValue({ _max: { order: null } });
      prisma.meetingDocument.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'd3', ...data }),
      );
      const xls = {
        ...file,
        mimetype: 'application/vnd.ms-excel',
        originalname: 'Old.xls',
      } as Express.Multer.File;

      await service.upload('c1', 'm1', xls, undefined, 'admin1');

      const fileUrl = (prisma.meetingDocument.create as jest.Mock).mock.calls[0][0].data.fileUrl;
      expect(fileUrl).toMatch(/\.xls$/);
    });

    it('rejects file >10MB', async () => {
      const bad = { ...file, size: 11 * 1024 * 1024 } as Express.Multer.File;
      await expect(service.upload('c1', 'm1', bad, undefined, 'admin1')).rejects.toThrow(BadRequestException);
    });

    it('rejects when meeting belongs to a different coop', async () => {
      prisma.meeting.findUnique.mockResolvedValue({ ...meeting, coopId: 'OTHER' });
      await expect(service.upload('c1', 'm1', file, undefined, 'admin1')).rejects.toThrow(ForbiddenException);
    });

    it('replaces in place when displayName matches existing', async () => {
      prisma.meeting.findUnique.mockResolvedValue(meeting);
      const existingDoc = {
        id: 'dExisting',
        meetingId: 'm1',
        fileName: 'Jaarverslag 2025.pdf',
        fileUrl: 'meeting-documents/m1/old.pdf',
        order: 2,
      };
      prisma.meetingDocument.findFirst.mockResolvedValue(existingDoc);
      // Pre-create old file so unlink succeeds
      const oldDir = path.join(tmpUploadDir, 'meeting-documents', 'm1');
      fs.mkdirSync(oldDir, { recursive: true });
      fs.writeFileSync(path.join(tmpUploadDir, existingDoc.fileUrl), 'old content');

      prisma.meetingDocument.update.mockImplementation(({ where, data }) =>
        Promise.resolve({ ...existingDoc, ...data, id: where.id }),
      );

      const result = await service.upload('c1', 'm1', file, undefined, 'admin1');

      expect(result.id).toBe('dExisting');
      expect(prisma.meetingDocument.create).not.toHaveBeenCalled();
      expect(prisma.meetingDocument.update).toHaveBeenCalledWith({
        where: { id: 'dExisting' },
        data: expect.objectContaining({ fileSize: 12, uploadedBy: 'admin1' }),
      });
      expect(fs.existsSync(path.join(tmpUploadDir, existingDoc.fileUrl))).toBe(false);
    });
  });

  describe('list / update / remove', () => {
    const meeting = { id: 'm1', coopId: 'c1' };

    it('lists documents for a meeting in order', async () => {
      prisma.meeting.findUnique.mockResolvedValue(meeting);
      prisma.meetingDocument.findMany.mockResolvedValue([
        { id: 'd1', order: 0, fileName: 'A.pdf' },
        { id: 'd2', order: 1, fileName: 'B.pdf' },
      ]);

      const docs = await service.list('c1', 'm1');

      expect(docs).toHaveLength(2);
      expect(prisma.meetingDocument.findMany).toHaveBeenCalledWith({
        where: { meetingId: 'm1' },
        orderBy: { order: 'asc' },
      });
    });

    it('updates display name and order', async () => {
      prisma.meeting.findUnique.mockResolvedValue(meeting);
      prisma.meetingDocument.findFirst.mockResolvedValue({ id: 'd1', meetingId: 'm1' });
      prisma.meetingDocument.update.mockResolvedValue({ id: 'd1', fileName: 'New.pdf', order: 5 });

      const result = await service.update('c1', 'm1', 'd1', { displayName: 'New.pdf', order: 5 });

      expect(result.fileName).toBe('New.pdf');
      expect(prisma.meetingDocument.update).toHaveBeenCalledWith({
        where: { id: 'd1' },
        data: { fileName: 'New.pdf', order: 5 },
      });
    });

    it('removes a document and deletes file from disk', async () => {
      prisma.meeting.findUnique.mockResolvedValue(meeting);
      const dir = path.join(tmpUploadDir, 'meeting-documents', 'm1');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'gone.pdf'), 'data');
      prisma.meetingDocument.findFirst.mockResolvedValue({
        id: 'd1',
        meetingId: 'm1',
        fileUrl: 'meeting-documents/m1/gone.pdf',
      });
      prisma.meetingDocument.delete.mockResolvedValue({ id: 'd1' });

      await service.remove('c1', 'm1', 'd1');

      expect(prisma.meetingDocument.delete).toHaveBeenCalledWith({ where: { id: 'd1' } });
      expect(fs.existsSync(path.join(dir, 'gone.pdf'))).toBe(false);
    });

    it('rejects update when document is not in meeting', async () => {
      prisma.meeting.findUnique.mockResolvedValue(meeting);
      prisma.meetingDocument.findFirst.mockResolvedValue(null);

      await expect(service.update('c1', 'm1', 'dX', { displayName: 'x' })).rejects.toThrow(NotFoundException);
    });
  });

  describe('email draft', () => {
    it('returns current draft with computed counts', async () => {
      prisma.meeting.findUnique.mockResolvedValue({
        id: 'm1',
        coopId: 'c1',
        documentsSubject: 'Custom subj',
        documentsIntro: 'Custom intro',
        documentsEmailSentAt: null,
      });
      prisma.meetingAttendance = {
        count: jest.fn().mockResolvedValueOnce(47).mockResolvedValueOnce(0).mockResolvedValueOnce(0),
      } as any;

      const draft = await service.getEmailDraft('c1', 'm1');

      expect(draft.subject).toBe('Custom subj');
      expect(draft.recipientCount).toBe(47);
      expect(draft.sentCount).toBe(0);
      expect(draft.failedCount).toBe(0);
    });

    it('updates subject and intro', async () => {
      prisma.meeting.findUnique.mockResolvedValue({ id: 'm1', coopId: 'c1' });
      prisma.meeting.update = jest.fn().mockResolvedValue({});

      await service.updateEmailDraft('c1', 'm1', { subject: 'New', intro: 'Body' });

      expect(prisma.meeting.update).toHaveBeenCalledWith({
        where: { id: 'm1' },
        data: { documentsSubject: 'New', documentsIntro: 'Body' },
      });
    });
  });

  describe('downloadByToken', () => {
    const meetingFuture = {
      id: 'm1',
      coopId: 'c1',
      scheduledAt: new Date(Date.now() + 86_400_000), // tomorrow
    };

    beforeEach(() => {
      prisma.meetingAttendance = {
        ...prisma.meetingAttendance,
        findUnique: jest.fn(),
        update: jest.fn(),
      } as any;
      prisma.meetingDocument.findUnique = jest.fn();
    });

    it('rejects unknown token', async () => {
      prisma.meetingAttendance.findUnique.mockResolvedValue(null);
      await expect(service.downloadByToken('badtoken', 'd1')).rejects.toThrow(NotFoundException);
    });

    it('rejects when document is not part of token meeting', async () => {
      prisma.meetingAttendance.findUnique.mockResolvedValue({
        id: 'a1', meetingId: 'm1', shareholderId: 's1', meeting: meetingFuture,
      });
      prisma.meetingDocument.findUnique.mockResolvedValue({ id: 'd1', meetingId: 'mOTHER', fileUrl: 'x.pdf', fileName: 'x.pdf' });
      await expect(service.downloadByToken('t1', 'd1')).rejects.toThrow(ForbiddenException);
    });

    it('rejects when past 30-day window', async () => {
      const longAgo = { ...meetingFuture, scheduledAt: new Date(Date.now() - 31 * 86_400_000) };
      prisma.meetingAttendance.findUnique.mockResolvedValue({
        id: 'a1', meetingId: 'm1', shareholderId: 's1', meeting: longAgo,
      });
      prisma.meetingDocument.findUnique.mockResolvedValue({ id: 'd1', meetingId: 'm1', fileUrl: 'x.pdf', fileName: 'x.pdf' });
      await expect(service.downloadByToken('t1', 'd1')).rejects.toThrow(ForbiddenException);
    });

    it('returns file metadata and sets downloadedAt on first download', async () => {
      const dir = path.join(tmpUploadDir, 'meeting-documents', 'm1');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'x.pdf'), 'PDF');

      prisma.meetingAttendance.findUnique.mockResolvedValue({
        id: 'a1', meetingId: 'm1', shareholderId: 's1', documentsDownloadedAt: null, meeting: meetingFuture,
      });
      prisma.meetingDocument.findUnique.mockResolvedValue({
        id: 'd1', meetingId: 'm1', fileUrl: 'meeting-documents/m1/x.pdf', fileName: 'Jaarverslag 2025.pdf',
      });

      const result = await service.downloadByToken('t1', 'd1');

      expect(result.absolutePath).toBe(path.join(tmpUploadDir, 'meeting-documents/m1/x.pdf'));
      expect(result.fileName).toBe('Jaarverslag 2025.pdf');
      expect(prisma.meetingAttendance.update).toHaveBeenCalledWith({
        where: { id: 'a1' },
        data: { documentsDownloadedAt: expect.any(Date) },
      });
    });

    it('does not overwrite downloadedAt on second download', async () => {
      fs.mkdirSync(path.join(tmpUploadDir, 'meeting-documents/m1'), { recursive: true });
      fs.writeFileSync(path.join(tmpUploadDir, 'meeting-documents/m1/x.pdf'), 'PDF');

      const earlier = new Date('2026-05-06T08:00:00Z');
      prisma.meetingAttendance.findUnique.mockResolvedValue({
        id: 'a1', meetingId: 'm1', shareholderId: 's1', documentsDownloadedAt: earlier, meeting: meetingFuture,
      });
      prisma.meetingDocument.findUnique.mockResolvedValue({
        id: 'd1', meetingId: 'm1', fileUrl: 'meeting-documents/m1/x.pdf', fileName: 'x.pdf',
      });

      await service.downloadByToken('t1', 'd1');

      expect(prisma.meetingAttendance.update).not.toHaveBeenCalled();
    });
  });

  describe('listAttendanceStatuses', () => {
    it('returns mapped status rows for a meeting', async () => {
      prisma.meeting.findUnique.mockResolvedValue({ id: 'm1', coopId: 'c1' });
      prisma.meetingAttendance.findMany.mockResolvedValue([
        {
          id: 'a1',
          documentsEmailSentAt: new Date('2026-05-08T10:00:00Z'),
          documentsEmailError: null,
          documentsEmailOpenedAt: new Date('2026-05-08T11:00:00Z'),
          documentsDownloadedAt: null,
          shareholder: { firstName: 'Jan', lastName: 'Peeters', companyName: null },
        },
        {
          id: 'a2',
          documentsEmailSentAt: null,
          documentsEmailError: 'bounce',
          documentsEmailOpenedAt: null,
          documentsDownloadedAt: null,
          shareholder: { firstName: null, lastName: null, companyName: 'BVBA Zon' },
        },
      ]);

      const result = await service.listAttendanceStatuses('c1', 'm1');

      expect(result).toHaveLength(2);
      expect(result[0].shareholderName).toBe('Jan Peeters');
      expect(result[0].documentsEmailSentAt).toEqual(new Date('2026-05-08T10:00:00Z'));
      expect(result[1].shareholderName).toBe('BVBA Zon');
      expect(result[1].documentsEmailError).toBe('bounce');
      expect(prisma.meetingAttendance.findMany).toHaveBeenCalledWith({
        where: { meetingId: 'm1' },
        include: {
          shareholder: { select: { firstName: true, lastName: true, companyName: true } },
        },
        orderBy: { id: 'asc' },
      });
    });
  });

  describe('pixelHit', () => {
    beforeEach(() => {
      prisma.meetingAttendance = {
        ...prisma.meetingAttendance,
        findUnique: jest.fn(),
        update: jest.fn(),
      } as any;
    });

    it('sets documentsEmailOpenedAt when token is valid and field is null', async () => {
      prisma.meetingAttendance.findUnique.mockResolvedValue({
        id: 'a1', meetingId: 'm1', documentsEmailOpenedAt: null,
      });
      prisma.meetingAttendance.update.mockResolvedValue({});

      await service.pixelHit('t1');

      expect(prisma.meetingAttendance.update).toHaveBeenCalledWith({
        where: { id: 'a1' },
        data: { documentsEmailOpenedAt: expect.any(Date) },
      });
    });

    it('does NOT call update when documentsEmailOpenedAt is already set', async () => {
      prisma.meetingAttendance.findUnique.mockResolvedValue({
        id: 'a1', meetingId: 'm1', documentsEmailOpenedAt: new Date('2026-05-08T10:00:00Z'),
      });

      await service.pixelHit('t1');

      expect(prisma.meetingAttendance.update).not.toHaveBeenCalled();
    });

    it('resolves without throwing and skips update on invalid token', async () => {
      prisma.meetingAttendance.findUnique.mockResolvedValue(null);

      await expect(service.pixelHit('invalid')).resolves.toBeUndefined();
      expect(prisma.meetingAttendance.update).not.toHaveBeenCalled();
    });
  });

  describe('send', () => {
    const baseMeeting = {
      id: 'm1',
      coopId: 'c1',
      status: 'CONVOKED',
      title: 'Algemene Vergadering 2026',
      scheduledAt: new Date('2026-05-09T10:00:00Z'),
      documentsEmailSentAt: null,
      documentsSubject: null,
      documentsIntro: null,
    };

    beforeEach(() => {
      prisma.meeting.update = jest.fn().mockResolvedValue({});
    });

    it('rejects when meeting not CONVOKED', async () => {
      prisma.meeting.findUnique.mockResolvedValue({ ...baseMeeting, status: 'DRAFT' });
      prisma.meetingDocument.findMany.mockResolvedValue([{ id: 'd1' }]);
      await expect(service.sendEmail('c1', 'm1', 'admin1')).rejects.toThrow(BadRequestException);
    });

    it('rejects when documentsEmailSentAt is within the 60-second concurrency window', async () => {
      const recentlySent = { ...baseMeeting, documentsEmailSentAt: new Date(Date.now() - 30_000) };
      prisma.meeting.findUnique.mockResolvedValue(recentlySent);
      prisma.meetingDocument.findMany.mockResolvedValue([{ id: 'd1' }]);
      await expect(service.sendEmail('c1', 'm1', 'admin1')).rejects.toThrow(BadRequestException);
    });

    it('rejects when no documents', async () => {
      prisma.meeting.findUnique.mockResolvedValue(baseMeeting);
      prisma.meetingDocument.findMany.mockResolvedValue([]);
      await expect(service.sendEmail('c1', 'm1', 'admin1')).rejects.toThrow(BadRequestException);
    });

    it('rejects retry when nothing failed', async () => {
      prisma.meeting.findUnique.mockResolvedValue({
        ...baseMeeting,
        documentsEmailSentAt: new Date(),
      });
      prisma.meetingDocument.findMany.mockResolvedValue([{ id: 'd1' }]);
      prisma.meetingAttendance.count.mockResolvedValue(0); // no failures
      await expect(service.sendEmail('c1', 'm1', 'admin1')).rejects.toThrow(BadRequestException);
    });

    it('first send: enqueues to all attendances', async () => {
      prisma.meeting.findUnique.mockResolvedValue({ ...baseMeeting, title: 'AV', documentsSubject: null, documentsIntro: null });
      prisma.meetingDocument.findMany.mockResolvedValue([{ id: 'd1', fileName: 'A.pdf' }]);
      prisma.meetingAttendance.findMany.mockResolvedValue([
        { id: 'a1', shareholderId: 's1', rsvpToken: 't1' },
        { id: 'a2', shareholderId: 's2', rsvpToken: 't2' },
      ]);
      prisma.shareholder.findUnique.mockResolvedValue({ email: 'x@y.be', firstName: 'Jan' });

      const result = await service.sendEmail('c1', 'm1', 'admin1');

      expect(result.enqueued).toBe(2);
      expect(emailService.queueDocumentsEmail).toHaveBeenCalledTimes(2);
      expect(prisma.meeting.update).toHaveBeenCalledWith({
        where: { id: 'm1' },
        data: { documentsEmailSentAt: expect.any(Date) },
      });
    });

    it('retry: enqueues only failed attendances and clears their error', async () => {
      prisma.meeting.findUnique.mockResolvedValue({
        ...baseMeeting,
        title: 'AV',
        documentsSubject: null,
        documentsIntro: null,
        documentsEmailSentAt: new Date('2026-05-06T14:00:00Z'),
      });
      prisma.meetingDocument.findMany.mockResolvedValue([{ id: 'd1', fileName: 'A.pdf' }]);
      prisma.meetingAttendance.count.mockResolvedValue(1);
      prisma.meetingAttendance.findMany.mockResolvedValue([
        { id: 'a3', shareholderId: 's3', rsvpToken: 't3', documentsEmailError: 'bounce' },
      ]);
      prisma.shareholder.findUnique.mockResolvedValue({ email: 'x@y.be', firstName: 'Jan' });

      const result = await service.sendEmail('c1', 'm1', 'admin1');

      expect(result.enqueued).toBe(1);
      expect(prisma.meetingAttendance.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['a3'] } },
        data: { documentsEmailError: null },
      });
    });
  });
});
