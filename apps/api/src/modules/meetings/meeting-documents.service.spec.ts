import { Test } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { MeetingDocumentsService } from './meeting-documents.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('MeetingDocumentsService', () => {
  let service: MeetingDocumentsService;
  let prisma: {
    meeting: { findUnique: jest.Mock };
    meetingDocument: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
      aggregate: jest.Mock;
    };
  };
  let tmpUploadDir: string;
  const ORIGINAL_UPLOAD_DIR = process.env.UPLOAD_DIR;

  beforeEach(async () => {
    tmpUploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencoop-test-'));
    process.env.UPLOAD_DIR = tmpUploadDir;

    prisma = {
      meeting: { findUnique: jest.fn() },
      meetingDocument: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        aggregate: jest.fn(),
      },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [MeetingDocumentsService, { provide: PrismaService, useValue: prisma }],
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
});
