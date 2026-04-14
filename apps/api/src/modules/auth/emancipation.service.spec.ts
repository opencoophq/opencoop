import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { EmancipationService } from './emancipation.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';

const mockShareholder = {
  id: 'sh1',
  firstName: 'Jan',
  lastName: 'Peeters',
  email: null,
  coopId: 'coop1',
  type: 'MINOR',
  coop: { name: 'Test Coöperatie' },
  registeredBy: { id: 'parent-user', email: 'parent@example.com' },
  user: { id: 'shared-user', email: 'shared@household.com' },
};

describe('EmancipationService', () => {
  let service: EmancipationService;
  let prisma: any;
  let emailService: any;

  beforeEach(async () => {
    prisma = {
      shareholder: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      shareholderEmancipationToken: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
        update: jest.fn(),
      },
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      $transaction: jest.fn((cb) =>
        cb({
          user: { create: jest.fn().mockResolvedValue({ id: 'new-user', email: 'new@email.com' }) },
          shareholder: { update: jest.fn() },
          shareholderEmancipationToken: { update: jest.fn() },
        }),
      ),
    };

    emailService = {
      sendMinorUpgradeNotification: jest.fn().mockResolvedValue(undefined),
      sendEmancipationHouseholdNotification: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmancipationService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailService, useValue: emailService },
      ],
    }).compile();

    service = module.get<EmancipationService>(EmancipationService);
  });

  // ============================================================================
  // startEmancipation
  // ============================================================================

  describe('startEmancipation(HOUSEHOLD_SPLIT)', () => {
    it('creates token and sends household email to shared-inbox user', async () => {
      prisma.shareholder.findUnique.mockResolvedValue(mockShareholder);
      const fakeToken = { id: 'tok1', token: 'abc', shareholderId: 'sh1' };
      prisma.shareholderEmancipationToken.upsert.mockResolvedValue(fakeToken);
      prisma.shareholderEmancipationToken.update.mockResolvedValue(fakeToken);

      const result = await service.startEmancipation({
        shareholderId: 'sh1',
        reason: 'HOUSEHOLD_SPLIT',
      });

      expect(result).toEqual(fakeToken);
      expect(prisma.shareholderEmancipationToken.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ reason: 'HOUSEHOLD_SPLIT' }),
        }),
      );
      expect(emailService.sendEmancipationHouseholdNotification).toHaveBeenCalledWith(
        'coop1',
        'shared@household.com',
        expect.objectContaining({ shareholderFirstName: 'Jan', coopName: 'Test Coöperatie' }),
      );
      expect(emailService.sendMinorUpgradeNotification).not.toHaveBeenCalled();
    });
  });

  describe('startEmancipation(MINOR_COMING_OF_AGE)', () => {
    it('creates token and sends minor upgrade email to parent (registeredBy)', async () => {
      prisma.shareholder.findUnique.mockResolvedValue(mockShareholder);
      const fakeToken = { id: 'tok2', token: 'def', shareholderId: 'sh1' };
      prisma.shareholderEmancipationToken.upsert.mockResolvedValue(fakeToken);
      prisma.shareholderEmancipationToken.update.mockResolvedValue(fakeToken);

      await service.startEmancipation({
        shareholderId: 'sh1',
        reason: 'MINOR_COMING_OF_AGE',
      });

      expect(emailService.sendMinorUpgradeNotification).toHaveBeenCalledWith(
        'coop1',
        'parent@example.com',
        expect.objectContaining({ minorFirstName: 'Jan', coopName: 'Test Coöperatie' }),
      );
      expect(emailService.sendEmancipationHouseholdNotification).not.toHaveBeenCalled();
    });
  });

  describe('startEmancipation — input guards', () => {
    it('throws BadRequestException when MINOR_COMING_OF_AGE is requested for a non-MINOR shareholder', async () => {
      prisma.shareholder.findUnique.mockResolvedValue({
        ...mockShareholder,
        type: 'INDIVIDUAL', // not a MINOR
      });

      await expect(
        service.startEmancipation({ shareholderId: 'sh1', reason: 'MINOR_COMING_OF_AGE' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('startEmancipation — recipient missing', () => {
    it('throws BadRequestException when parent email is missing for MINOR_COMING_OF_AGE', async () => {
      prisma.shareholder.findUnique.mockResolvedValue({
        ...mockShareholder,
        type: 'MINOR',
        registeredBy: null, // no parent
      });

      await expect(
        service.startEmancipation({ shareholderId: 'sh1', reason: 'MINOR_COMING_OF_AGE' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when shareholder has no linked user for HOUSEHOLD_SPLIT', async () => {
      prisma.shareholder.findUnique.mockResolvedValue({
        ...mockShareholder,
        user: null, // no linked user
      });

      await expect(
        service.startEmancipation({ shareholderId: 'sh1', reason: 'HOUSEHOLD_SPLIT' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ============================================================================
  // consumeEmancipation
  // ============================================================================

  describe('consumeEmancipation', () => {
    const validToken = {
      id: 'tok3',
      token: 'valid-token',
      shareholderId: 'sh1',
      usedAt: null,
      expiresAt: new Date(Date.now() + 86400000), // 1 day from now
      shareholder: { id: 'sh1', coopId: 'coop1' },
    };

    it('creates new User, migrates shareholder.userId and shareholder.email', async () => {
      prisma.shareholderEmancipationToken.findUnique.mockResolvedValue(validToken);
      prisma.user.findUnique.mockResolvedValue(null); // email not taken

      const txUser = { id: 'new-user', email: 'newuser@example.com' };
      const txCreate = jest.fn().mockResolvedValue(txUser);
      const txShUpdate = jest.fn().mockResolvedValue({});
      const txTokUpdate = jest.fn().mockResolvedValue({});
      prisma.$transaction.mockImplementation((cb: (tx: any) => Promise<any>) =>
        cb({
          user: { create: txCreate },
          shareholder: { update: txShUpdate },
          shareholderEmancipationToken: { update: txTokUpdate },
        }),
      );

      const result = await service.consumeEmancipation({
        token: 'valid-token',
        email: 'newuser@example.com',
        password: 'Password1',
      });

      expect(result.user.id).toBe('new-user');
      expect(txCreate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ email: 'newuser@example.com' }) }),
      );
      expect(txShUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: 'new-user', email: 'newuser@example.com' }),
        }),
      );
      expect(txTokUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ usedAt: expect.any(Date) }) }),
      );
    });

    it('throws BadRequestException if token already used', async () => {
      prisma.shareholderEmancipationToken.findUnique.mockResolvedValue({
        ...validToken,
        usedAt: new Date(),
      });

      await expect(
        service.consumeEmancipation({ token: 'used-token', email: 'a@b.com', password: 'Pw1pass!' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException if token expired', async () => {
      prisma.shareholderEmancipationToken.findUnique.mockResolvedValue({
        ...validToken,
        expiresAt: new Date(Date.now() - 1000), // past
      });

      await expect(
        service.consumeEmancipation({ token: 'expired-token', email: 'a@b.com', password: 'Pw1pass!' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException if email is already registered', async () => {
      prisma.shareholderEmancipationToken.findUnique.mockResolvedValue(validToken);
      prisma.user.findUnique.mockResolvedValue({ id: 'existing-user' });

      await expect(
        service.consumeEmancipation({ token: 'valid-token', email: 'taken@example.com', password: 'Pw1pass!' }),
      ).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException for invalid token', async () => {
      prisma.shareholderEmancipationToken.findUnique.mockResolvedValue(null);

      await expect(
        service.consumeEmancipation({ token: 'bogus', email: 'a@b.com', password: 'Pw1pass!' }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
