import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PontoService } from './ponto.service';
import { PontoClient } from './ponto.client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentsService } from '../payments/payments.service';
import { EmailService } from '../email/email.service';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('../../common/crypto/field-encryption', () => ({
  encryptField: jest.fn((v: string) => `encrypted:${v}`),
  decryptField: jest.fn((v: string) => v.replace('encrypted:', '')),
}));

// Stable mock for randomBytes / createHash
jest.mock('crypto', () => {
  const actual = jest.requireActual('crypto');
  return {
    ...actual,
    randomBytes: jest.fn((size: number) => Buffer.alloc(size, 'a')),
    createHash: jest.fn(() => ({
      update: jest.fn().mockReturnThis(),
      digest: jest.fn(() => Buffer.from('mock-sha256-digest')),
    })),
  };
});

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

process.env.PONTO_CLIENT_ID = 'test-client-id';
process.env.PONTO_CLIENT_SECRET = 'test-client-secret';
process.env.PONTO_REDIRECT_URI = 'https://example.com/callback';
process.env.FIELD_ENCRYPTION_KEY = 'a'.repeat(64);

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

describe('PontoService', () => {
  let service: PontoService;

  const mockPrisma = {
    coop: {
      findUnique: jest.fn(),
    },
    pontoConnection: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    bankTransaction: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    registration: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    payment: {
      create: jest.fn(),
    },
    $transaction: jest.fn((fn: (tx: any) => Promise<any>) => fn(mockPrisma)),
  };

  const mockPontoClient = {
    generateAuthorizationUrl: jest.fn(),
    exchangeAuthorizationCode: jest.fn(),
    refreshAccessToken: jest.fn(),
    revokeToken: jest.fn(),
    getAccounts: jest.fn(),
    getValidAccessToken: jest.fn(),
    getUpdatedTransactions: jest.fn(),
  };

  const mockPaymentsService = {
    addPayment: jest.fn(),
  };

  const mockEmailService = {
    sendPaymentConfirmation: jest.fn(),
    send: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PontoService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PontoClient, useValue: mockPontoClient },
        { provide: PaymentsService, useValue: mockPaymentsService },
        { provide: EmailService, useValue: mockEmailService },
      ],
    }).compile();

    service = module.get<PontoService>(PontoService);

    jest.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // initiateConnection
  // -----------------------------------------------------------------------

  describe('initiateConnection', () => {
    it('should throw BadRequestException if coop does not exist', async () => {
      mockPrisma.coop.findUnique.mockResolvedValue(null);

      await expect(service.initiateConnection('coop-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException if pontoEnabled is false', async () => {
      mockPrisma.coop.findUnique.mockResolvedValue({
        id: 'coop-1',
        pontoEnabled: false,
      });

      await expect(service.initiateConnection('coop-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw if ACTIVE connection already exists', async () => {
      mockPrisma.coop.findUnique.mockResolvedValue({
        id: 'coop-1',
        pontoEnabled: true,
      });
      mockPrisma.pontoConnection.findUnique.mockResolvedValue({
        id: 'conn-1',
        status: 'ACTIVE',
      });

      await expect(service.initiateConnection('coop-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should delete existing PENDING connection and create new one', async () => {
      mockPrisma.coop.findUnique.mockResolvedValue({
        id: 'coop-1',
        pontoEnabled: true,
      });
      mockPrisma.pontoConnection.findUnique.mockResolvedValue({
        id: 'conn-old',
        status: 'PENDING',
      });
      mockPrisma.pontoConnection.create.mockResolvedValue({
        id: 'conn-new',
        status: 'PENDING',
      });
      mockPontoClient.generateAuthorizationUrl.mockReturnValue(
        'https://ponto.example.com/auth?state=test',
      );

      const result = await service.initiateConnection('coop-1');

      expect(mockPrisma.pontoConnection.delete).toHaveBeenCalledWith({
        where: { id: 'conn-old' },
      });
      expect(mockPrisma.pontoConnection.create).toHaveBeenCalled();
      expect(result).toEqual({
        authorizationUrl: 'https://ponto.example.com/auth?state=test',
      });
    });

    it('should create PENDING connection and return authorizationUrl', async () => {
      mockPrisma.coop.findUnique.mockResolvedValue({
        id: 'coop-1',
        pontoEnabled: true,
      });
      mockPrisma.pontoConnection.findUnique.mockResolvedValue(null);
      mockPrisma.pontoConnection.create.mockResolvedValue({
        id: 'conn-new',
        status: 'PENDING',
      });
      mockPontoClient.generateAuthorizationUrl.mockReturnValue(
        'https://ponto.example.com/auth?state=abc',
      );

      const result = await service.initiateConnection('coop-1');

      expect(result.authorizationUrl).toBe(
        'https://ponto.example.com/auth?state=abc',
      );
      expect(mockPrisma.pontoConnection.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          coopId: 'coop-1',
          status: 'PENDING',
        }),
      });
    });
  });

  // -----------------------------------------------------------------------
  // handleCallback
  // -----------------------------------------------------------------------

  describe('handleCallback', () => {
    it('should exchange code for tokens and activate connection', async () => {
      mockPontoClient.exchangeAuthorizationCode.mockResolvedValue({
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
        expiresIn: 1800,
      });
      mockPontoClient.getAccounts.mockResolvedValue([
        {
          id: 'acc-1',
          iban: 'BE68539007547034',
          currency: 'EUR',
          description: 'Current',
          financialInstitutionName: 'KBC',
        },
      ]);
      mockPrisma.pontoConnection.update.mockResolvedValue({
        id: 'conn-1',
        status: 'ACTIVE',
      });

      await service.handleCallback('conn-1', 'auth-code', 'code-verifier');

      expect(
        mockPontoClient.exchangeAuthorizationCode,
      ).toHaveBeenCalledWith('auth-code', 'code-verifier', expect.any(String));

      expect(mockPrisma.pontoConnection.update).toHaveBeenCalledWith({
        where: { id: 'conn-1' },
        data: expect.objectContaining({
          accessToken: 'encrypted:new-access',
          refreshToken: 'encrypted:new-refresh',
          pontoAccountId: 'acc-1',
          iban: 'BE68539007547034',
          bankName: 'KBC',
          status: 'ACTIVE',
        }),
      });
    });

    it('should handle empty accounts list gracefully', async () => {
      mockPontoClient.exchangeAuthorizationCode.mockResolvedValue({
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
        expiresIn: 1800,
      });
      mockPontoClient.getAccounts.mockResolvedValue([]);
      mockPrisma.pontoConnection.update.mockResolvedValue({
        id: 'conn-1',
        status: 'ACTIVE',
      });

      await service.handleCallback('conn-1', 'auth-code', 'code-verifier');

      expect(mockPrisma.pontoConnection.update).toHaveBeenCalledWith({
        where: { id: 'conn-1' },
        data: expect.objectContaining({
          pontoAccountId: null,
          iban: null,
          bankName: null,
          status: 'ACTIVE',
        }),
      });
    });
  });

  // -----------------------------------------------------------------------
  // disconnect
  // -----------------------------------------------------------------------

  describe('disconnect', () => {
    it('should revoke token and delete connection', async () => {
      mockPrisma.pontoConnection.findUnique.mockResolvedValue({
        id: 'conn-1',
        coopId: 'coop-1',
        accessToken: 'encrypted:token-to-revoke',
        status: 'ACTIVE',
      });
      mockPontoClient.revokeToken.mockResolvedValue(undefined);
      mockPrisma.pontoConnection.delete.mockResolvedValue({});

      await service.disconnect('coop-1');

      expect(mockPontoClient.revokeToken).toHaveBeenCalledWith(
        'token-to-revoke',
      );
      expect(mockPrisma.pontoConnection.delete).toHaveBeenCalledWith({
        where: { id: 'conn-1' },
      });
    });

    it('should throw NotFoundException if no connection exists', async () => {
      mockPrisma.pontoConnection.findUnique.mockResolvedValue(null);

      await expect(service.disconnect('coop-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should still delete connection if revoke fails', async () => {
      mockPrisma.pontoConnection.findUnique.mockResolvedValue({
        id: 'conn-1',
        coopId: 'coop-1',
        accessToken: 'encrypted:token-to-revoke',
        status: 'ACTIVE',
      });
      mockPontoClient.revokeToken.mockRejectedValue(new Error('Revoke failed'));
      mockPrisma.pontoConnection.delete.mockResolvedValue({});

      await service.disconnect('coop-1');

      expect(mockPrisma.pontoConnection.delete).toHaveBeenCalledWith({
        where: { id: 'conn-1' },
      });
    });
  });

  // -----------------------------------------------------------------------
  // processTransaction
  // -----------------------------------------------------------------------

  describe('processTransaction', () => {
    const structuredTxn = {
      id: 'tx-1',
      amount: 250,
      currency: 'EUR',
      remittanceInformation: '+++090/9337/55493+++',
      remittanceInformationType: 'structured',
      counterpartName: 'Jan Peeters',
      counterpartReference: 'BE68539007547034',
      valueDate: '2024-01-15',
      executionDate: '2024-01-15',
      description: 'Share purchase',
    };

    const unstructuredTxn = {
      ...structuredTxn,
      id: 'tx-2',
      remittanceInformation: 'Random payment',
      remittanceInformationType: 'unstructured',
    };

    it('should skip duplicate transactions', async () => {
      mockPrisma.bankTransaction.findUnique.mockResolvedValue({
        id: 'existing-bt',
      });

      await (service as any).processTransaction(structuredTxn, 'coop-1', true);

      expect(mockPrisma.bankTransaction.create).not.toHaveBeenCalled();
    });

    it('should auto-match structured OGM and create payment', async () => {
      mockPrisma.bankTransaction.findUnique.mockResolvedValue(null); // no duplicate
      const mockRegistration = {
        id: 'reg-1',
        coopId: 'coop-1',
        ogmCode: '090933755493',
        status: 'PENDING_PAYMENT',
        totalAmount: 250,
        payments: [],
        shareholder: {
          id: 'sh-1',
          firstName: 'Jan',
          lastName: 'Peeters',
          email: 'jan@example.com',
        },
      };
      mockPrisma.registration.findFirst.mockResolvedValue(mockRegistration);

      const createdBankTxn = {
        id: 'bt-1',
        pontoTransactionId: 'tx-1',
        matchStatus: 'AUTO_MATCHED',
      };
      mockPrisma.bankTransaction.create.mockResolvedValue(createdBankTxn);
      mockPaymentsService.addPayment.mockResolvedValue({ id: 'pay-1' });

      await (service as any).processTransaction(structuredTxn, 'coop-1', true);

      // Should create bank transaction with AUTO_MATCHED status
      expect(mockPrisma.bankTransaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          coopId: 'coop-1',
          pontoTransactionId: 'tx-1',
          amount: 250,
          ogmCode: '090933755493',
          matchStatus: 'AUTO_MATCHED',
        }),
      });

      // Should create payment via PaymentsService with the original transaction amount
      expect(mockPaymentsService.addPayment).toHaveBeenCalledWith({
        registrationId: 'reg-1',
        coopId: 'coop-1',
        amount: 250,
        bankDate: new Date('2024-01-15'),
        bankTransactionId: 'bt-1',
      });
    });

    it('should mark unmatched when no registration found', async () => {
      mockPrisma.bankTransaction.findUnique.mockResolvedValue(null);
      mockPrisma.registration.findFirst.mockResolvedValue(null);

      const createdBankTxn = {
        id: 'bt-2',
        pontoTransactionId: 'tx-2',
        matchStatus: 'UNMATCHED',
      };
      mockPrisma.bankTransaction.create.mockResolvedValue(createdBankTxn);

      await (service as any).processTransaction(
        unstructuredTxn,
        'coop-1',
        true,
      );

      expect(mockPrisma.bankTransaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          matchStatus: 'UNMATCHED',
          ogmCode: null,
        }),
      });
      expect(mockPaymentsService.addPayment).not.toHaveBeenCalled();
    });

    it('should not create payment when autoMatch is false even if matched', async () => {
      mockPrisma.bankTransaction.findUnique.mockResolvedValue(null);
      mockPrisma.registration.findFirst.mockResolvedValue({
        id: 'reg-1',
        coopId: 'coop-1',
        ogmCode: '090933755493',
        status: 'PENDING_PAYMENT',
      });

      const createdBankTxn = {
        id: 'bt-3',
        matchStatus: 'AUTO_MATCHED',
      };
      mockPrisma.bankTransaction.create.mockResolvedValue(createdBankTxn);

      await (service as any).processTransaction(
        structuredTxn,
        'coop-1',
        false,
      );

      expect(mockPrisma.bankTransaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          matchStatus: 'AUTO_MATCHED',
        }),
      });
      expect(mockPaymentsService.addPayment).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // processNewTransactions
  // -----------------------------------------------------------------------

  describe('processNewTransactions', () => {
    it('should filter out negative amounts and process incoming transactions', async () => {
      mockPrisma.pontoConnection.findFirst.mockResolvedValue({
        id: 'conn-1',
        coopId: 'coop-1',
        pontoAccountId: 'acc-1',
        status: 'ACTIVE',
        coop: { id: 'coop-1', autoMatchPayments: true },
      });
      mockPontoClient.getValidAccessToken.mockResolvedValue('valid-token');
      mockPontoClient.getUpdatedTransactions.mockResolvedValue([
        {
          id: 'tx-in',
          amount: 100,
          currency: 'EUR',
          remittanceInformation: 'payment',
          remittanceInformationType: 'unstructured',
          counterpartName: 'Alice',
          counterpartReference: '',
          valueDate: '2024-01-15',
          executionDate: '2024-01-15',
          description: 'incoming',
        },
        {
          id: 'tx-out',
          amount: -50,
          currency: 'EUR',
          remittanceInformation: 'refund',
          remittanceInformationType: 'unstructured',
          counterpartName: 'Bob',
          counterpartReference: '',
          valueDate: '2024-01-15',
          executionDate: '2024-01-15',
          description: 'outgoing',
        },
      ]);

      // Mock processTransaction (private) to verify it's called only for positive amounts
      const processSpy = jest
        .spyOn(service as any, 'processTransaction')
        .mockResolvedValue(undefined);

      await service.processNewTransactions('sync-1', 'acc-1');

      // Should only process the incoming (positive) transaction
      expect(processSpy).toHaveBeenCalledTimes(1);
      expect(processSpy).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'tx-in', amount: 100 }),
        'coop-1',
        true,
      );
    });

    it('should throw if no active connection found', async () => {
      mockPrisma.pontoConnection.findFirst.mockResolvedValue(null);

      await expect(
        service.processNewTransactions('sync-1', 'acc-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // -----------------------------------------------------------------------
  // reauthorize
  // -----------------------------------------------------------------------

  describe('reauthorize', () => {
    it('should delete expired connection, revoke token, and initiate new connection', async () => {
      // First call: reauthorize looks up existing connection
      mockPrisma.pontoConnection.findUnique.mockResolvedValueOnce({
        id: 'conn-expired',
        coopId: 'coop-1',
        accessToken: 'encrypted:old-token',
        status: 'EXPIRED',
      });
      mockPontoClient.revokeToken.mockResolvedValue(undefined);
      mockPrisma.pontoConnection.delete.mockResolvedValue({});

      // Second call: initiateConnection looks up coop
      mockPrisma.coop.findUnique.mockResolvedValue({
        id: 'coop-1',
        pontoEnabled: true,
      });
      // Third call: initiateConnection checks for existing connection (now gone)
      mockPrisma.pontoConnection.findUnique.mockResolvedValueOnce(null);
      mockPrisma.pontoConnection.create.mockResolvedValue({
        id: 'conn-new',
        status: 'PENDING',
      });
      mockPontoClient.generateAuthorizationUrl.mockReturnValue(
        'https://ponto.example.com/auth?state=reauth',
      );

      const result = await service.reauthorize('coop-1');

      // Old connection should be deleted
      expect(mockPrisma.pontoConnection.delete).toHaveBeenCalledWith({
        where: { id: 'conn-expired' },
      });
      // Token should be revoked
      expect(mockPontoClient.revokeToken).toHaveBeenCalledWith('old-token');
      // Should return new authorization URL
      expect(result).toEqual({
        authorizationUrl: 'https://ponto.example.com/auth?state=reauth',
      });
    });
  });

  // -----------------------------------------------------------------------
  // handleCallbackByState
  // -----------------------------------------------------------------------

  describe('handleCallbackByState', () => {
    it('should find matching PENDING connection by state and handle callback', async () => {
      mockPrisma.pontoConnection.findMany.mockResolvedValue([
        {
          id: 'conn-wrong',
          coopId: 'coop-2',
          accessToken: 'encrypted:verifier-wrong',
          refreshToken: 'encrypted:other-state',
          status: 'PENDING',
        },
        {
          id: 'conn-match',
          coopId: 'coop-1',
          accessToken: 'encrypted:verifier-correct',
          refreshToken: 'encrypted:matching-state',
          status: 'PENDING',
        },
      ]);

      // Mock handleCallback internals
      mockPontoClient.exchangeAuthorizationCode.mockResolvedValue({
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
        expiresIn: 1800,
      });
      mockPontoClient.getAccounts.mockResolvedValue([
        {
          id: 'acc-1',
          iban: 'BE68539007547034',
          currency: 'EUR',
          description: 'Current',
          financialInstitutionName: 'KBC',
        },
      ]);
      mockPrisma.pontoConnection.update.mockResolvedValue({
        id: 'conn-match',
        status: 'ACTIVE',
      });

      const coopId = await service.handleCallbackByState(
        'auth-code',
        'matching-state',
      );

      expect(coopId).toBe('coop-1');
      expect(mockPontoClient.exchangeAuthorizationCode).toHaveBeenCalledWith(
        'auth-code',
        'verifier-correct',
        expect.any(String),
      );
      expect(mockPrisma.pontoConnection.update).toHaveBeenCalledWith({
        where: { id: 'conn-match' },
        data: expect.objectContaining({
          status: 'ACTIVE',
        }),
      });
    });

    it('should throw BadRequestException when no matching state found', async () => {
      mockPrisma.pontoConnection.findMany.mockResolvedValue([
        {
          id: 'conn-1',
          coopId: 'coop-1',
          accessToken: 'encrypted:verifier',
          refreshToken: 'encrypted:some-state',
          status: 'PENDING',
        },
      ]);

      await expect(
        service.handleCallbackByState('auth-code', 'non-matching-state'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // -----------------------------------------------------------------------
  // getConnectionStatus
  // -----------------------------------------------------------------------

  describe('getConnectionStatus', () => {
    it('should return connection info when exists', async () => {
      mockPrisma.pontoConnection.findUnique.mockResolvedValue({
        id: 'conn-1',
        coopId: 'coop-1',
        status: 'ACTIVE',
        iban: 'BE68539007547034',
        bankName: 'KBC',
        lastSyncAt: new Date('2024-01-15'),
        authExpiresAt: new Date('2024-04-15'),
      });

      const result = await service.getConnectionStatus('coop-1');

      expect(result).toEqual(
        expect.objectContaining({
          status: 'ACTIVE',
          iban: 'BE68539007547034',
          bankName: 'KBC',
        }),
      );
    });

    it('should return null when no connection exists', async () => {
      mockPrisma.pontoConnection.findUnique.mockResolvedValue(null);

      const result = await service.getConnectionStatus('coop-1');

      expect(result).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // checkConnectionHealth
  // -----------------------------------------------------------------------

  describe('checkConnectionHealth', () => {
    it('should mark expired connections as EXPIRED', async () => {
      const expiredDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // yesterday
      mockPrisma.pontoConnection.findMany.mockResolvedValue([
        {
          id: 'conn-1',
          coopId: 'coop-1',
          status: 'ACTIVE',
          authExpiresAt: expiredDate,
          lastSyncAt: new Date(),
          expiryNotifiedAt: null,
          coop: {
            id: 'coop-1',
            name: 'Test Coop',
            admins: [{ user: { email: 'admin@test.com' } }],
          },
        },
      ]);
      mockPrisma.pontoConnection.update.mockResolvedValue({});

      await service.checkConnectionHealth();

      expect(mockPrisma.pontoConnection.update).toHaveBeenCalledWith({
        where: { id: 'conn-1' },
        data: { status: 'EXPIRED' },
      });
    });

    it('should notify admins when connection expires within 7 days', async () => {
      const nearExpiryDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000); // 5 days from now
      mockPrisma.pontoConnection.findMany.mockResolvedValue([
        {
          id: 'conn-2',
          coopId: 'coop-2',
          status: 'ACTIVE',
          authExpiresAt: nearExpiryDate,
          lastSyncAt: new Date(),
          expiryNotifiedAt: null,
          coop: {
            id: 'coop-2',
            name: 'Expiring Coop',
            admins: [{ user: { email: 'admin@coop2.com' } }],
          },
        },
      ]);
      mockPrisma.pontoConnection.update.mockResolvedValue({});

      await service.checkConnectionHealth();

      expect(mockEmailService.send).toHaveBeenCalledWith(
        expect.objectContaining({
          coopId: 'coop-2',
          to: 'admin@coop2.com',
          templateKey: 'ponto-expiry-warning',
        }),
      );
      expect(mockPrisma.pontoConnection.update).toHaveBeenCalledWith({
        where: { id: 'conn-2' },
        data: { expiryNotifiedAt: expect.any(Date) },
      });
    });
  });
});
