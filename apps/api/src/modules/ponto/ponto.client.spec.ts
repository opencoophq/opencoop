import { Test, TestingModule } from '@nestjs/testing';
import { PontoClient, PontoTokens } from './ponto.client';
import { PrismaService } from '../../prisma/prisma.service';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('../../common/crypto/field-encryption', () => ({
  encryptField: jest.fn((v: string) => `encrypted:${v}`),
  decryptField: jest.fn((v: string) => v.replace('encrypted:', '')),
}));

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

process.env.PONTO_CLIENT_ID = 'test-client-id';
process.env.PONTO_CLIENT_SECRET = 'test-client-secret';
process.env.PONTO_SANDBOX = 'true';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

describe('PontoClient', () => {
  let client: PontoClient;
  let prisma: PrismaService;

  const mockPrisma = {
    pontoConnection: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PontoClient,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    client = module.get<PontoClient>(PontoClient);
    prisma = module.get<PrismaService>(PrismaService);

    jest.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // generateAuthorizationUrl
  // -----------------------------------------------------------------------

  describe('generateAuthorizationUrl', () => {
    it('should include all required OAuth params', () => {
      const url = client.generateAuthorizationUrl(
        'https://example.com/callback',
        'test-code-challenge',
        'test-state-123',
      );

      expect(url).toContain('client_id=test-client-id');
      expect(url).toContain('redirect_uri=' + encodeURIComponent('https://example.com/callback'));
      expect(url).toContain('response_type=code');
      expect(url).toContain('scope=ai+offline_access');
      expect(url).toContain('code_challenge=test-code-challenge');
      expect(url).toContain('code_challenge_method=S256');
      expect(url).toContain('state=test-state-123');
    });

    it('should use sandbox auth base when PONTO_SANDBOX is true', () => {
      const url = client.generateAuthorizationUrl('http://cb', 'ch', 'st');
      expect(url).toContain('sandbox-authorization.myponto.com');
    });
  });

  // -----------------------------------------------------------------------
  // exchangeAuthorizationCode
  // -----------------------------------------------------------------------

  describe('exchangeAuthorizationCode', () => {
    it('should return PontoTokens from postTokenRequest', async () => {
      const expectedTokens: PontoTokens = {
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
        expiresIn: 1800,
      };

      jest
        .spyOn(client as any, 'postTokenRequest')
        .mockResolvedValue(expectedTokens);

      const result = await client.exchangeAuthorizationCode(
        'auth-code',
        'code-verifier',
        'https://example.com/callback',
      );

      expect(result).toEqual(expectedTokens);
      expect((client as any).postTokenRequest).toHaveBeenCalledWith({
        grant_type: 'authorization_code',
        code: 'auth-code',
        code_verifier: 'code-verifier',
        redirect_uri: 'https://example.com/callback',
      });
    });
  });

  // -----------------------------------------------------------------------
  // refreshAccessToken
  // -----------------------------------------------------------------------

  describe('refreshAccessToken', () => {
    it('should return PontoTokens from postTokenRequest', async () => {
      const expectedTokens: PontoTokens = {
        accessToken: 'refreshed-access',
        refreshToken: 'refreshed-refresh',
        expiresIn: 1800,
      };

      jest
        .spyOn(client as any, 'postTokenRequest')
        .mockResolvedValue(expectedTokens);

      const result = await client.refreshAccessToken('old-refresh-token');

      expect(result).toEqual(expectedTokens);
      expect((client as any).postTokenRequest).toHaveBeenCalledWith({
        grant_type: 'refresh_token',
        refresh_token: 'old-refresh-token',
      });
    });
  });

  // -----------------------------------------------------------------------
  // parseJsonApiList
  // -----------------------------------------------------------------------

  describe('parseJsonApiList', () => {
    it('should extract array of items from JSON:API data', () => {
      const response = {
        data: [
          {
            id: 'tx-001',
            type: 'transaction',
            attributes: {
              amount: 25.0,
              currency: 'EUR',
              remittanceInformation: '+++090/9337/55493+++',
              remittanceInformationType: 'structured',
              counterpartName: 'Jan Peeters',
              counterpartReference: 'BE68539007547034',
              valueDate: '2024-01-15',
              executionDate: '2024-01-15',
              description: 'Aankoop aandelen',
            },
          },
          {
            id: 'tx-002',
            type: 'transaction',
            attributes: {
              amount: 50.0,
              currency: 'EUR',
              remittanceInformation: 'Free text reference',
              remittanceInformationType: 'unstructured',
              counterpartName: 'Marie Dubois',
              counterpartReference: 'BE71096123456769',
              valueDate: '2024-01-16',
              executionDate: '2024-01-16',
              description: 'Share purchase',
            },
          },
        ],
      };

      const result = client.parseJsonApiList(response);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: 'tx-001',
        amount: 25.0,
        currency: 'EUR',
        remittanceInformation: '+++090/9337/55493+++',
        remittanceInformationType: 'structured',
        counterpartName: 'Jan Peeters',
        counterpartReference: 'BE68539007547034',
        valueDate: '2024-01-15',
        executionDate: '2024-01-15',
        description: 'Aankoop aandelen',
      });
      expect(result[1].id).toBe('tx-002');
      expect((result[1] as any).counterpartName).toBe('Marie Dubois');
    });

    it('should return empty array for empty data', () => {
      const result = client.parseJsonApiList({ data: [] });
      expect(result).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // parseJsonApiItem
  // -----------------------------------------------------------------------

  describe('parseJsonApiItem', () => {
    it('should extract a single item from JSON:API data', () => {
      const response = {
        data: {
          id: 'acc-001',
          type: 'account',
          attributes: {
            iban: 'BE68539007547034',
            currency: 'EUR',
            description: 'Current Account',
            financialInstitutionName: 'KBC',
          },
        },
      };

      const result = client.parseJsonApiItem(response);

      expect(result).toEqual({
        id: 'acc-001',
        iban: 'BE68539007547034',
        currency: 'EUR',
        description: 'Current Account',
        financialInstitutionName: 'KBC',
      });
    });
  });

  // -----------------------------------------------------------------------
  // getValidAccessToken
  // -----------------------------------------------------------------------

  describe('getValidAccessToken', () => {
    it('should return decrypted access token when token is still valid', async () => {
      const futureDate = new Date(Date.now() + 10 * 60 * 1000); // 10 min in the future
      mockPrisma.pontoConnection.findUnique.mockResolvedValue({
        id: 'conn-1',
        accessToken: 'encrypted:my-access-token',
        refreshToken: 'encrypted:my-refresh-token',
        tokenExpiresAt: futureDate,
      });

      const refreshSpy = jest
        .spyOn(client, 'refreshAccessToken')
        .mockResolvedValue({
          accessToken: 'should-not-be-used',
          refreshToken: 'should-not-be-used',
          expiresIn: 1800,
        });

      const result = await client.getValidAccessToken('conn-1');

      expect(result).toBe('my-access-token');
      expect(refreshSpy).not.toHaveBeenCalled();
      expect(mockPrisma.pontoConnection.update).not.toHaveBeenCalled();
    });

    it('should refresh and persist new tokens when token is expired', async () => {
      const pastDate = new Date(Date.now() - 10 * 60 * 1000); // 10 min in the past
      mockPrisma.pontoConnection.findUnique.mockResolvedValue({
        id: 'conn-1',
        accessToken: 'encrypted:old-access',
        refreshToken: 'encrypted:old-refresh',
        tokenExpiresAt: pastDate,
      });

      const newTokens: PontoTokens = {
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
        expiresIn: 1800,
      };

      const refreshSpy = jest
        .spyOn(client, 'refreshAccessToken')
        .mockResolvedValue(newTokens);

      mockPrisma.pontoConnection.update.mockResolvedValue({});

      const result = await client.getValidAccessToken('conn-1');

      expect(result).toBe('new-access-token');
      expect(refreshSpy).toHaveBeenCalledWith('old-refresh');
      expect(mockPrisma.pontoConnection.update).toHaveBeenCalledWith({
        where: { id: 'conn-1' },
        data: {
          accessToken: 'encrypted:new-access-token',
          refreshToken: 'encrypted:new-refresh-token',
          tokenExpiresAt: expect.any(Date),
        },
      });
    });
  });
});
