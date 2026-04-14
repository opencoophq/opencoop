import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bull';
import { EmailService } from './email.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('EmailService', () => {
  let service: EmailService;

  const mockPrisma = {
    user: {
      findUnique: jest.fn(),
    },
    emailLog: {
      create: jest.fn(),
    },
  };

  const mockQueue = {
    add: jest.fn(),
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        EmailService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: getQueueToken('email'), useValue: mockQueue },
      ],
    }).compile();

    service = module.get<EmailService>(EmailService);
    jest.clearAllMocks();
  });

  describe('resolveRecipientLanguage', () => {
    it('returns the user preferredLanguage when set', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ preferredLanguage: 'fr' });
      const result = await (service as any).resolveRecipientLanguage('user@example.com');
      expect(result).toBe('fr');
    });

    it('returns "nl" when user is not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      const result = await (service as any).resolveRecipientLanguage('nobody@example.com');
      expect(result).toBe('nl');
    });

    it('returns "nl" when preferredLanguage is empty or null', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ preferredLanguage: null });
      const result = await (service as any).resolveRecipientLanguage('user@example.com');
      expect(result).toBe('nl');

      mockPrisma.user.findUnique.mockResolvedValue({ preferredLanguage: '' });
      const result2 = await (service as any).resolveRecipientLanguage('user@example.com');
      expect(result2).toBe('nl');
    });

    it('lowercases the email when looking up', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ preferredLanguage: 'en' });
      await (service as any).resolveRecipientLanguage('User@Example.COM');
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'user@example.com' },
        select: { preferredLanguage: true },
      });
    });
  });
});
