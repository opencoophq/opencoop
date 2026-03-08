# Ponto Connect Integration — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Integrate Ponto Connect (Isabel Group) for automatic payment reconciliation via OGM code matching on incoming bank transactions.

**Architecture:** Webhook-driven. Ponto sends `transactionsCreated` webhooks → Bull queue processes them → OGM matching creates Payment records → registration status auto-transitions. Each coop connects their bank account via OAuth2 (self-service). Feature gated by system admin toggle.

**Tech Stack:** NestJS, Prisma, Bull/Redis, OAuth2 + PKCE, mTLS (HTTPS client certificates), AES-256-GCM encryption, Next.js App Router

**Design doc:** `docs/plans/2026-03-08-ponto-integration-design.md`

---

### Task 1: Database Schema Changes

**Files:**
- Modify: `packages/database/prisma/schema.prisma`

**Step 1: Add PontoConnectionStatus enum and PontoConnection model**

Add after the existing enums (around line 88):

```prisma
enum PontoConnectionStatus {
  PENDING
  ACTIVE
  EXPIRED
  REVOKED
}
```

Add after the `AuditLog` model (end of file):

```prisma
model PontoConnection {
  id                  String                @id @default(cuid())
  coopId              String                @unique
  coop                Coop                  @relation(fields: [coopId], references: [id], onDelete: Cascade)

  accessToken         String
  refreshToken        String
  tokenExpiresAt      DateTime

  pontoAccountId      String?
  pontoOrganizationId String?
  iban                String?
  bankName            String?

  status              PontoConnectionStatus @default(PENDING)
  lastSyncAt          DateTime?
  authExpiresAt       DateTime?
  expiryNotifiedAt    DateTime?

  createdAt           DateTime              @default(now())
  updatedAt           DateTime              @updatedAt
}
```

**Step 2: Add fields to Coop model**

Add to the Coop model settings section (after `minimumHoldingPeriod`):

```prisma
  pontoEnabled        Boolean @default(false)
  autoMatchPayments   Boolean @default(true)
```

Add to the Coop model relations section:

```prisma
  pontoConnection  PontoConnection?
```

**Step 3: Add pontoTransactionId to BankTransaction model**

Add to the BankTransaction model:

```prisma
  pontoTransactionId  String? @unique
```

**Step 4: Generate Prisma client and create migration**

Run:
```bash
cd packages/database && npx prisma migrate dev --name add_ponto_connection
```

**Step 5: Commit**

```bash
git add packages/database/prisma/
git commit -m "feat(db): add PontoConnection model and Ponto fields"
```

---

### Task 2: Ponto API Client

**Files:**
- Create: `apps/api/src/modules/ponto/ponto.client.ts`
- Create: `apps/api/src/modules/ponto/ponto.client.spec.ts`

This is the low-level HTTP client that handles mTLS, OAuth token refresh, HTTP signing, and JSON:API parsing.

**Step 1: Write failing test for token refresh logic**

```typescript
// apps/api/src/modules/ponto/ponto.client.spec.ts
import { Test } from '@nestjs/testing';
import { PontoClient } from './ponto.client';
import { PrismaService } from '../../prisma/prisma.service';

describe('PontoClient', () => {
  let client: PontoClient;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        PontoClient,
        {
          provide: PrismaService,
          useValue: {
            pontoConnection: {
              update: jest.fn(),
              findUnique: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    client = module.get(PontoClient);
    prisma = module.get(PrismaService);
  });

  describe('exchangeAuthorizationCode', () => {
    it('should exchange code for tokens and return them', async () => {
      const mockResponse = {
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_in: 1800,
        token_type: 'bearer',
        scope: 'ai',
      };

      jest.spyOn(client as any, 'postTokenRequest').mockResolvedValue(mockResponse);

      const result = await client.exchangeAuthorizationCode('auth-code', 'code-verifier');

      expect(result.accessToken).toBe('new-access-token');
      expect(result.refreshToken).toBe('new-refresh-token');
      expect(result.expiresIn).toBe(1800);
    });
  });

  describe('refreshAccessToken', () => {
    it('should use refresh token and return new token pair', async () => {
      const mockResponse = {
        access_token: 'refreshed-access',
        refresh_token: 'rotated-refresh',
        expires_in: 1800,
        token_type: 'bearer',
        scope: 'ai',
      };

      jest.spyOn(client as any, 'postTokenRequest').mockResolvedValue(mockResponse);

      const result = await client.refreshAccessToken('old-refresh-token');

      expect(result.accessToken).toBe('refreshed-access');
      expect(result.refreshToken).toBe('rotated-refresh');
    });
  });

  describe('parseJsonApi', () => {
    it('should extract data from JSON:API response', () => {
      const jsonApiResponse = {
        data: [
          {
            id: 'txn-1',
            type: 'transaction',
            attributes: {
              amount: 250.0,
              currency: 'EUR',
              remittanceInformation: '+++090/0001/00197+++',
              remittanceInformationType: 'structured',
              counterpartName: 'Jan Peeters',
              counterpartReference: 'BE71096123456769',
              valueDate: '2026-03-08',
              executionDate: '2026-03-08',
            },
          },
        ],
      };

      const result = (client as any).parseJsonApiList(jsonApiResponse);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('txn-1');
      expect(result[0].amount).toBe(250.0);
      expect(result[0].remittanceInformation).toBe('+++090/0001/00197+++');
      expect(result[0].remittanceInformationType).toBe('structured');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/api && npx jest --testPathPattern=ponto.client.spec --no-coverage`
Expected: FAIL (module not found)

**Step 3: Implement PontoClient**

```typescript
// apps/api/src/modules/ponto/ponto.client.ts
import { Injectable, Logger } from '@nestjs/common';
import * as https from 'https';
import * as fs from 'fs';
import { PrismaService } from '../../prisma/prisma.service';
import { encryptField, decryptField } from '../../common/crypto/field-encryption';

interface PontoTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface PontoTransaction {
  id: string;
  amount: number;
  currency: string;
  remittanceInformation: string;
  remittanceInformationType: string;
  counterpartName: string;
  counterpartReference: string;
  valueDate: string;
  executionDate: string;
  description: string;
}

interface PontoAccount {
  id: string;
  iban: string;
  currency: string;
  description: string;
  financialInstitutionName: string;
}

@Injectable()
export class PontoClient {
  private readonly logger = new Logger(PontoClient.name);
  private readonly baseUrl = 'https://api.ibanity.com/ponto-connect';
  private readonly authUrl = process.env.PONTO_SANDBOX === 'true'
    ? 'https://sandbox-authorization.myponto.com'
    : 'https://authorization.myponto.com';
  private httpsAgent: https.Agent | undefined;

  constructor(private readonly prisma: PrismaService) {}

  private getHttpsAgent(): https.Agent {
    if (this.httpsAgent) return this.httpsAgent;

    const certPath = process.env.PONTO_CERT_PATH;
    const keyPath = process.env.PONTO_KEY_PATH;
    const passphrase = process.env.PONTO_KEY_PASSPHRASE;

    if (!certPath || !keyPath) {
      throw new Error('PONTO_CERT_PATH and PONTO_KEY_PATH must be set');
    }

    this.httpsAgent = new https.Agent({
      cert: fs.readFileSync(certPath),
      key: fs.readFileSync(keyPath),
      passphrase,
    });

    return this.httpsAgent;
  }

  // --- OAuth ---

  generateAuthorizationUrl(redirectUri: string, codeChallenge: string, state: string): string {
    const params = new URLSearchParams({
      client_id: process.env.PONTO_CLIENT_ID!,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'ai offline_access',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
    });
    return `${this.authUrl}/oauth2/auth?${params}`;
  }

  async exchangeAuthorizationCode(code: string, codeVerifier: string): Promise<PontoTokens> {
    const body = {
      grant_type: 'authorization_code',
      code,
      code_verifier: codeVerifier,
      redirect_uri: `${process.env.API_URL || 'http://localhost:3001'}/ponto/callback`,
      client_id: process.env.PONTO_CLIENT_ID!,
    };
    return this.postTokenRequest(body);
  }

  async refreshAccessToken(refreshToken: string): Promise<PontoTokens> {
    const body = {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: process.env.PONTO_CLIENT_ID!,
    };
    return this.postTokenRequest(body);
  }

  async revokeToken(token: string): Promise<void> {
    await this.postTokenRequest({
      token,
      client_id: process.env.PONTO_CLIENT_ID!,
    }, '/oauth2/revoke');
  }

  private async postTokenRequest(
    body: Record<string, string>,
    path = '/oauth2/token',
  ): Promise<PontoTokens> {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(
          `${process.env.PONTO_CLIENT_ID}:${process.env.PONTO_CLIENT_SECRET}`,
        ).toString('base64')}`,
      },
      body: new URLSearchParams(body),
      // @ts-expect-error Node.js fetch supports agent
      agent: this.getHttpsAgent(),
    });

    if (!response.ok) {
      const text = await response.text();
      this.logger.error(`Token request failed: ${response.status} ${text}`);
      throw new Error(`Ponto token request failed: ${response.status}`);
    }

    const data = await response.json();
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
    };
  }

  // --- API Calls ---

  async getAccounts(accessToken: string): Promise<PontoAccount[]> {
    const data = await this.apiGet('/accounts', accessToken);
    return this.parseJsonApiList(data);
  }

  async getAccount(accessToken: string, accountId: string): Promise<PontoAccount> {
    const data = await this.apiGet(`/accounts/${accountId}`, accessToken);
    return this.parseJsonApiItem(data);
  }

  async getUpdatedTransactions(
    accessToken: string,
    synchronizationId: string,
  ): Promise<PontoTransaction[]> {
    const data = await this.apiGet(
      `/synchronizations/${synchronizationId}/updated-transactions`,
      accessToken,
    );
    return this.parseJsonApiList(data);
  }

  async getTransactions(
    accessToken: string,
    accountId: string,
    limit = 100,
  ): Promise<PontoTransaction[]> {
    const data = await this.apiGet(
      `/accounts/${accountId}/transactions?page[limit]=${limit}`,
      accessToken,
    );
    return this.parseJsonApiList(data);
  }

  async createSynchronization(
    accessToken: string,
    accountId: string,
    subtype: 'accountDetails' | 'accountTransactions',
  ): Promise<{ id: string; status: string }> {
    const body = {
      data: {
        type: 'synchronization',
        attributes: {
          resourceType: 'account',
          subtype,
          resourceId: accountId,
        },
      },
    };
    const data = await this.apiPost('/synchronizations', accessToken, body);
    return this.parseJsonApiItem(data);
  }

  async getSynchronization(
    accessToken: string,
    synchronizationId: string,
  ): Promise<{ id: string; status: string }> {
    const data = await this.apiGet(`/synchronizations/${synchronizationId}`, accessToken);
    return this.parseJsonApiItem(data);
  }

  // --- Token Management for Connections ---

  async getValidAccessToken(connectionId: string): Promise<string> {
    const connection = await this.prisma.pontoConnection.findUnique({
      where: { id: connectionId },
    });

    if (!connection) throw new Error(`PontoConnection ${connectionId} not found`);

    const decryptedAccess = decryptField(connection.accessToken);
    const decryptedRefresh = decryptField(connection.refreshToken);

    // Check if token is still valid (with 60s buffer)
    if (connection.tokenExpiresAt > new Date(Date.now() + 60_000)) {
      return decryptedAccess;
    }

    // Refresh the token
    this.logger.log(`Refreshing access token for connection ${connectionId}`);
    const tokens = await this.refreshAccessToken(decryptedRefresh);

    // Store new tokens (encrypted)
    await this.prisma.pontoConnection.update({
      where: { id: connectionId },
      data: {
        accessToken: encryptField(tokens.accessToken),
        refreshToken: encryptField(tokens.refreshToken),
        tokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000),
      },
    });

    return tokens.accessToken;
  }

  // --- HTTP helpers ---

  private async apiGet(path: string, accessToken: string): Promise<any> {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.api+json',
      },
      // @ts-expect-error Node.js fetch supports agent
      agent: this.getHttpsAgent(),
    });

    if (!response.ok) {
      const text = await response.text();
      this.logger.error(`API GET ${path} failed: ${response.status} ${text}`);
      throw new Error(`Ponto API GET failed: ${response.status}`);
    }

    return response.json();
  }

  private async apiPost(path: string, accessToken: string, body: any): Promise<any> {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/vnd.api+json',
        Accept: 'application/vnd.api+json',
      },
      body: JSON.stringify(body),
      // @ts-expect-error Node.js fetch supports agent
      agent: this.getHttpsAgent(),
    });

    if (!response.ok) {
      const text = await response.text();
      this.logger.error(`API POST ${path} failed: ${response.status} ${text}`);
      throw new Error(`Ponto API POST failed: ${response.status}`);
    }

    return response.json();
  }

  // --- JSON:API parsing ---

  private parseJsonApiList(response: any): any[] {
    if (!response?.data || !Array.isArray(response.data)) return [];
    return response.data.map((item: any) => ({
      id: item.id,
      ...item.attributes,
    }));
  }

  private parseJsonApiItem(response: any): any {
    if (!response?.data) return null;
    return {
      id: response.data.id,
      ...response.data.attributes,
    };
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/api && npx jest --testPathPattern=ponto.client.spec --no-coverage`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/api/src/modules/ponto/
git commit -m "feat(ponto): add Ponto API client with mTLS and OAuth support"
```

---

### Task 3: Ponto Service — OAuth Flow

**Files:**
- Create: `apps/api/src/modules/ponto/ponto.service.ts`
- Create: `apps/api/src/modules/ponto/ponto.service.spec.ts`

**Step 1: Write failing tests for OAuth connect/callback/disconnect**

```typescript
// apps/api/src/modules/ponto/ponto.service.spec.ts
import { Test } from '@nestjs/testing';
import { PontoService } from './ponto.service';
import { PontoClient } from './ponto.client';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';

describe('PontoService', () => {
  let service: PontoService;
  let prisma: PrismaService;
  let pontoClient: PontoClient;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        PontoService,
        {
          provide: PontoClient,
          useValue: {
            generateAuthorizationUrl: jest.fn(),
            exchangeAuthorizationCode: jest.fn(),
            getAccounts: jest.fn(),
            revokeToken: jest.fn(),
            getValidAccessToken: jest.fn(),
            getUpdatedTransactions: jest.fn(),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            coop: { findUnique: jest.fn() },
            pontoConnection: {
              create: jest.fn(),
              update: jest.fn(),
              findUnique: jest.fn(),
              delete: jest.fn(),
            },
            bankTransaction: { create: jest.fn(), findUnique: jest.fn() },
            registration: { findFirst: jest.fn() },
            $transaction: jest.fn((fn) => fn(prisma)),
          },
        },
        {
          provide: EmailService,
          useValue: { send: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(PontoService);
    prisma = module.get(PrismaService);
    pontoClient = module.get(PontoClient);
  });

  describe('initiateConnection', () => {
    it('should throw if ponto not enabled for coop', async () => {
      (prisma.coop.findUnique as jest.Mock).mockResolvedValue({
        id: 'coop-1',
        pontoEnabled: false,
      });

      await expect(service.initiateConnection('coop-1')).rejects.toThrow(BadRequestException);
    });

    it('should return authorization URL and create pending connection', async () => {
      (prisma.coop.findUnique as jest.Mock).mockResolvedValue({
        id: 'coop-1',
        pontoEnabled: true,
        pontoConnection: null,
      });
      (pontoClient.generateAuthorizationUrl as jest.Mock).mockReturnValue('https://ponto.example/auth');
      (prisma.pontoConnection.create as jest.Mock).mockResolvedValue({ id: 'conn-1' });

      const result = await service.initiateConnection('coop-1');

      expect(result.authorizationUrl).toBe('https://ponto.example/auth');
      expect(prisma.pontoConnection.create).toHaveBeenCalled();
    });
  });

  describe('handleCallback', () => {
    it('should exchange code, store tokens, and activate connection', async () => {
      (prisma.pontoConnection.findUnique as jest.Mock).mockResolvedValue({
        id: 'conn-1',
        coopId: 'coop-1',
        status: 'PENDING',
      });
      (pontoClient.exchangeAuthorizationCode as jest.Mock).mockResolvedValue({
        accessToken: 'access-123',
        refreshToken: 'refresh-123',
        expiresIn: 1800,
      });
      (pontoClient.getAccounts as jest.Mock).mockResolvedValue([
        { id: 'acct-1', iban: 'BE71096123456769', financialInstitutionName: 'KBC' },
      ]);
      (prisma.pontoConnection.update as jest.Mock).mockResolvedValue({
        id: 'conn-1',
        status: 'ACTIVE',
      });

      await service.handleCallback('conn-1', 'auth-code', 'code-verifier');

      expect(pontoClient.exchangeAuthorizationCode).toHaveBeenCalledWith('auth-code', 'code-verifier');
      expect(prisma.pontoConnection.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'conn-1' },
          data: expect.objectContaining({
            status: 'ACTIVE',
            pontoAccountId: 'acct-1',
            iban: 'BE71096123456769',
            bankName: 'KBC',
          }),
        }),
      );
    });
  });

  describe('disconnect', () => {
    it('should revoke token and delete connection', async () => {
      (prisma.pontoConnection.findUnique as jest.Mock).mockResolvedValue({
        id: 'conn-1',
        coopId: 'coop-1',
        refreshToken: 'encrypted-refresh',
        status: 'ACTIVE',
      });
      (prisma.pontoConnection.delete as jest.Mock).mockResolvedValue({});

      await service.disconnect('coop-1');

      expect(prisma.pontoConnection.delete).toHaveBeenCalledWith({
        where: { coopId: 'coop-1' },
      });
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/api && npx jest --testPathPattern=ponto.service.spec --no-coverage`
Expected: FAIL

**Step 3: Implement PontoService**

```typescript
// apps/api/src/modules/ponto/ponto.service.ts
import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import * as crypto from 'crypto';
import { PontoClient, PontoTransaction } from './ponto.client';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { encryptField, decryptField } from '../../common/crypto/field-encryption';

@Injectable()
export class PontoService {
  private readonly logger = new Logger(PontoService.name);

  constructor(
    private readonly pontoClient: PontoClient,
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  // --- OAuth Flow ---

  async initiateConnection(coopId: string): Promise<{ authorizationUrl: string }> {
    const coop = await this.prisma.coop.findUnique({
      where: { id: coopId },
      include: { pontoConnection: true },
    });

    if (!coop?.pontoEnabled) {
      throw new BadRequestException('Ponto is not enabled for this coop');
    }

    // Delete existing pending connection if any
    if (coop.pontoConnection?.status === 'PENDING') {
      await this.prisma.pontoConnection.delete({ where: { coopId } });
    } else if (coop.pontoConnection?.status === 'ACTIVE') {
      throw new BadRequestException('Bank account already connected');
    }

    // Generate PKCE
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');

    const state = crypto.randomBytes(16).toString('hex');
    const redirectUri = `${process.env.API_URL || 'http://localhost:3001'}/ponto/callback`;

    // Store PKCE verifier and state in PontoConnection (encrypted)
    await this.prisma.pontoConnection.create({
      data: {
        coopId,
        accessToken: encryptField(codeVerifier), // Temporarily store code_verifier here
        refreshToken: encryptField(state),        // Temporarily store state here
        tokenExpiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 min expiry for OAuth flow
        status: 'PENDING',
      },
    });

    const authorizationUrl = this.pontoClient.generateAuthorizationUrl(
      redirectUri,
      codeChallenge,
      state,
    );

    return { authorizationUrl };
  }

  async handleCallback(connectionId: string, code: string, codeVerifier: string): Promise<void> {
    const connection = await this.prisma.pontoConnection.findUnique({
      where: { id: connectionId },
    });

    if (!connection || connection.status !== 'PENDING') {
      throw new BadRequestException('Invalid or expired connection');
    }

    // Exchange code for tokens
    const tokens = await this.pontoClient.exchangeAuthorizationCode(code, codeVerifier);

    // Fetch available accounts
    const accounts = await this.pontoClient.getAccounts(tokens.accessToken);

    if (accounts.length === 0) {
      throw new BadRequestException('No bank accounts were authorized');
    }

    // Use first account (most coops have one account for share capital)
    const account = accounts[0];

    // Store tokens and activate
    await this.prisma.pontoConnection.update({
      where: { id: connectionId },
      data: {
        accessToken: encryptField(tokens.accessToken),
        refreshToken: encryptField(tokens.refreshToken),
        tokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000),
        pontoAccountId: account.id,
        pontoOrganizationId: null, // Set from userinfo if needed
        iban: account.iban,
        bankName: account.financialInstitutionName,
        status: 'ACTIVE',
        authExpiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days PSD2
      },
    });
  }

  async handleCallbackByState(code: string, state: string): Promise<string> {
    // Find connection by state (stored encrypted in refreshToken field during PENDING)
    const connections = await this.prisma.pontoConnection.findMany({
      where: { status: 'PENDING' },
    });

    const connection = connections.find((c) => {
      try {
        return decryptField(c.refreshToken) === state;
      } catch {
        return false;
      }
    });

    if (!connection) {
      throw new BadRequestException('Invalid OAuth state');
    }

    const codeVerifier = decryptField(connection.accessToken);
    await this.handleCallback(connection.id, code, codeVerifier);

    // Return coopId for redirect
    return connection.coopId;
  }

  async disconnect(coopId: string): Promise<void> {
    const connection = await this.prisma.pontoConnection.findUnique({
      where: { coopId },
    });

    if (!connection) {
      throw new NotFoundException('No Ponto connection found');
    }

    // Try to revoke token (best effort)
    try {
      const refreshToken = decryptField(connection.refreshToken);
      await this.pontoClient.revokeToken(refreshToken);
    } catch (e) {
      this.logger.warn(`Failed to revoke Ponto token for coop ${coopId}: ${e.message}`);
    }

    await this.prisma.pontoConnection.delete({ where: { coopId } });
  }

  async getConnectionStatus(coopId: string) {
    const connection = await this.prisma.pontoConnection.findUnique({
      where: { coopId },
    });

    if (!connection) return null;

    return {
      status: connection.status,
      iban: connection.iban,
      bankName: connection.bankName,
      lastSyncAt: connection.lastSyncAt,
      authExpiresAt: connection.authExpiresAt,
    };
  }

  async reauthorize(coopId: string): Promise<{ authorizationUrl: string }> {
    // Delete expired connection and start fresh
    await this.prisma.pontoConnection.deleteMany({
      where: { coopId, status: { in: ['EXPIRED', 'REVOKED'] } },
    });
    return this.initiateConnection(coopId);
  }

  // --- Transaction Processing ---

  async processNewTransactions(
    synchronizationId: string,
    pontoAccountId: string,
  ): Promise<void> {
    const connection = await this.prisma.pontoConnection.findFirst({
      where: { pontoAccountId, status: 'ACTIVE' },
      include: { coop: true },
    });

    if (!connection) {
      this.logger.warn(`No active connection for Ponto account ${pontoAccountId}`);
      return;
    }

    const accessToken = await this.pontoClient.getValidAccessToken(connection.id);
    const transactions = await this.pontoClient.getUpdatedTransactions(
      accessToken,
      synchronizationId,
    );

    // Filter: only incoming payments (positive amount)
    const incomingPayments = transactions.filter((t) => t.amount > 0);

    for (const txn of incomingPayments) {
      await this.processTransaction(txn, connection.coopId, connection.coop.autoMatchPayments);
    }

    // Update last sync time
    await this.prisma.pontoConnection.update({
      where: { id: connection.id },
      data: { lastSyncAt: new Date() },
    });
  }

  private async processTransaction(
    txn: PontoTransaction,
    coopId: string,
    autoMatch: boolean,
  ): Promise<void> {
    // Dedup check
    const existing = await this.prisma.bankTransaction.findUnique({
      where: { pontoTransactionId: txn.id },
    });
    if (existing) return;

    // Extract OGM if structured
    const ogmCode =
      txn.remittanceInformationType === 'structured' ? txn.remittanceInformation : null;

    // Try to match against pending registrations
    let matchedRegistration = null;
    if (ogmCode) {
      matchedRegistration = await this.prisma.registration.findFirst({
        where: {
          coopId,
          ogmCode,
          status: { in: ['PENDING_PAYMENT', 'ACTIVE'] },
        },
        include: { shareholder: true },
      });
    }

    const matchStatus = matchedRegistration ? 'AUTO_MATCHED' : 'UNMATCHED';

    // Create BankTransaction
    const bankTransaction = await this.prisma.bankTransaction.create({
      data: {
        coopId,
        bankImportId: null as any, // Not from CSV import — need schema change to make nullable
        date: new Date(txn.valueDate),
        amount: txn.amount,
        counterparty: txn.counterpartName,
        ogmCode,
        referenceText: txn.remittanceInformationType === 'unstructured'
          ? txn.remittanceInformation
          : null,
        matchStatus,
        pontoTransactionId: txn.id,
      },
    });

    if (matchedRegistration && autoMatch) {
      // Auto-create payment and transition registration
      await this.createPaymentFromTransaction(bankTransaction, matchedRegistration, coopId);
    } else if (matchedRegistration && !autoMatch) {
      // Matched but needs admin confirmation — store the match but don't create payment
      this.logger.log(
        `Auto-matched txn ${txn.id} to registration ${matchedRegistration.id} — awaiting admin confirmation`,
      );
      // TODO: Send in-app notification to coop admin
    } else {
      // Unmatched — notify admin
      this.logger.log(`Unmatched incoming payment: ${txn.amount} EUR from ${txn.counterpartName}`);
      // TODO: Send notification to coop admin
    }
  }

  private async createPaymentFromTransaction(
    bankTransaction: any,
    registration: any,
    coopId: string,
  ): Promise<void> {
    // Use existing payments service pattern
    const totalPaid = await this.prisma.payment.aggregate({
      where: { registrationId: registration.id },
      _sum: { amount: true },
    });

    const previouslyPaid = Number(totalPaid._sum.amount || 0);
    const newTotal = previouslyPaid + Number(bankTransaction.amount);
    const totalAmount = Number(registration.totalAmount);

    // Determine new registration status
    let newStatus = registration.status;
    if (registration.status === 'PENDING_PAYMENT') {
      newStatus = newTotal >= totalAmount ? 'COMPLETED' : 'ACTIVE';
    } else if (registration.status === 'ACTIVE') {
      newStatus = newTotal >= totalAmount ? 'COMPLETED' : 'ACTIVE';
    }

    await this.prisma.$transaction(async (tx) => {
      // Create payment
      await tx.payment.create({
        data: {
          registrationId: registration.id,
          coopId,
          amount: bankTransaction.amount,
          bankDate: bankTransaction.date,
          bankTransactionId: bankTransaction.id,
          matchedAt: new Date(),
        },
      });

      // Update registration status
      if (newStatus !== registration.status) {
        await tx.registration.update({
          where: { id: registration.id },
          data: { status: newStatus },
        });
      }
    });

    // Send confirmation email
    if (registration.shareholder?.email) {
      await this.emailService.send({
        coopId,
        to: registration.shareholder.email,
        subject: 'Payment received',
        templateKey: 'payment-confirmation',
        templateData: {
          shareholderName: registration.shareholder.firstName,
          amount: Number(bankTransaction.amount),
          registrationId: registration.id,
        },
      });
    }
  }

  // --- Health Check ---

  async checkConnectionHealth(): Promise<void> {
    const connections = await this.prisma.pontoConnection.findMany({
      where: { status: 'ACTIVE' },
      include: { coop: { include: { admins: { include: { user: true } } } } },
    });

    for (const conn of connections) {
      // Check PSD2 auth expiry
      if (conn.authExpiresAt) {
        const daysUntilExpiry = Math.floor(
          (conn.authExpiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
        );

        if (daysUntilExpiry <= 0) {
          // Expired — mark as expired
          await this.prisma.pontoConnection.update({
            where: { id: conn.id },
            data: { status: 'EXPIRED' },
          });
          this.logger.warn(`Ponto connection expired for coop ${conn.coopId}`);
        } else if (daysUntilExpiry <= 7 && !conn.expiryNotifiedAt) {
          // Send reminder email to coop admins
          for (const admin of conn.coop.admins) {
            await this.emailService.send({
              coopId: conn.coopId,
              to: admin.user.email,
              subject: 'Bank connection expiring soon',
              templateKey: 'ponto-expiry-warning',
              templateData: {
                coopName: conn.coop.name,
                bankName: conn.bankName,
                daysUntilExpiry,
              },
            });
          }
          await this.prisma.pontoConnection.update({
            where: { id: conn.id },
            data: { expiryNotifiedAt: new Date() },
          });
        }
      }

      // Check sync staleness
      if (conn.lastSyncAt) {
        const hoursSinceSync = (Date.now() - conn.lastSyncAt.getTime()) / (1000 * 60 * 60);
        if (hoursSinceSync > 24) {
          this.logger.warn(
            `Ponto connection ${conn.id} (coop ${conn.coopId}) hasn't synced in ${Math.floor(hoursSinceSync)}h`,
          );
        }
      }
    }
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `cd apps/api && npx jest --testPathPattern=ponto.service.spec --no-coverage`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/api/src/modules/ponto/
git commit -m "feat(ponto): add PontoService with OAuth flow and transaction processing"
```

---

### Task 4: Ponto Controllers

**Files:**
- Create: `apps/api/src/modules/ponto/ponto.controller.ts`
- Create: `apps/api/src/modules/ponto/ponto.admin.controller.ts`
- Create: `apps/api/src/modules/ponto/dto/ponto-connect.dto.ts`
- Create: `apps/api/src/modules/ponto/dto/ponto-webhook.dto.ts`

**Step 1: Create DTOs**

```typescript
// apps/api/src/modules/ponto/dto/ponto-connect.dto.ts
import { IsBoolean, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdatePontoSettingsDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  autoMatchPayments?: boolean;
}
```

```typescript
// apps/api/src/modules/ponto/dto/ponto-webhook.dto.ts
// Webhook payloads are not validated via class-validator — verified by signature instead
export interface PontoWebhookPayload {
  data: {
    id: string;
    type: string;
    attributes: {
      eventType: string;
      synchronizationId?: string;
      accountId?: string;
      organizationId?: string;
      count?: number;
    };
  };
}
```

**Step 2: Create public controller (OAuth callback + webhooks)**

```typescript
// apps/api/src/modules/ponto/ponto.controller.ts
import { Controller, Get, Post, Query, Req, Res, Logger, RawBodyRequest } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiExcludeEndpoint } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { Public } from '../../common/decorators/public.decorator';
import { PontoService } from './ponto.service';
import { PontoWebhookPayload } from './dto/ponto-webhook.dto';
import * as crypto from 'crypto';

@Controller('ponto')
@ApiTags('Ponto')
export class PontoController {
  private readonly logger = new Logger(PontoController.name);

  constructor(
    private readonly pontoService: PontoService,
    @InjectQueue('ponto') private readonly pontoQueue: Queue,
  ) {}

  @Get('callback')
  @Public()
  @ApiOperation({ summary: 'OAuth2 callback from Ponto' })
  async handleCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    const coopId = await this.pontoService.handleCallbackByState(code, state);

    // Redirect to coop admin settings page
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3002';
    res.redirect(`${frontendUrl}/dashboard/admin/settings?ponto=connected`);
  }

  @Post('webhooks')
  @Public()
  @ApiExcludeEndpoint()
  async handleWebhook(@Req() req: RawBodyRequest<Request>, @Res() res: Response) {
    // Verify webhook signature
    const signature = req.headers['x-signature'] as string;
    if (!this.verifyWebhookSignature(req.rawBody, signature)) {
      this.logger.warn('Invalid Ponto webhook signature');
      return res.status(401).send('Invalid signature');
    }

    const payload: PontoWebhookPayload = req.body;
    const eventType = payload.data?.attributes?.eventType;

    if (eventType === 'pontoConnect.account.transactionsCreated') {
      const { synchronizationId, accountId } = payload.data.attributes;

      // Enqueue for async processing
      await this.pontoQueue.add('process-transactions', {
        synchronizationId,
        accountId,
      });
    }

    // Always return 200 quickly
    return res.status(200).send('OK');
  }

  private verifyWebhookSignature(rawBody: Buffer | undefined, signature: string): boolean {
    const secret = process.env.PONTO_WEBHOOK_SIGNING_KEY;
    if (!secret || !rawBody || !signature) return false;

    const expected = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  }
}
```

**Step 3: Create admin controller**

```typescript
// apps/api/src/modules/ponto/ponto.admin.controller.ts
import { Controller, Get, Post, Put, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CoopGuard } from '../../common/guards/coop.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { PontoService } from './ponto.service';
import { UpdatePontoSettingsDto } from './dto/ponto-connect.dto';
import { PrismaService } from '../../prisma/prisma.service';

@Controller('admin/coops/:coopId/ponto')
@UseGuards(JwtAuthGuard, RolesGuard, CoopGuard, SubscriptionGuard, PermissionGuard)
@Roles('SYSTEM_ADMIN', 'COOP_ADMIN')
@ApiBearerAuth()
@ApiTags('Ponto Admin')
export class PontoAdminController {
  constructor(
    private readonly pontoService: PontoService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('status')
  @RequirePermission('canManageSettings')
  @ApiOperation({ summary: 'Get Ponto connection status' })
  async getStatus(@Param('coopId') coopId: string) {
    const coop = await this.prisma.coop.findUnique({
      where: { id: coopId },
      select: { pontoEnabled: true, autoMatchPayments: true },
    });
    const connection = await this.pontoService.getConnectionStatus(coopId);
    return {
      pontoEnabled: coop?.pontoEnabled ?? false,
      autoMatchPayments: coop?.autoMatchPayments ?? true,
      connection,
    };
  }

  @Get('connect')
  @RequirePermission('canManageSettings')
  @ApiOperation({ summary: 'Get Ponto OAuth authorization URL' })
  async connect(@Param('coopId') coopId: string) {
    return this.pontoService.initiateConnection(coopId);
  }

  @Post('disconnect')
  @RequirePermission('canManageSettings')
  @ApiOperation({ summary: 'Disconnect Ponto bank account' })
  async disconnect(@Param('coopId') coopId: string) {
    await this.pontoService.disconnect(coopId);
    return { success: true };
  }

  @Post('reauthorize')
  @RequirePermission('canManageSettings')
  @ApiOperation({ summary: 'Re-authorize expired Ponto connection' })
  async reauthorize(@Param('coopId') coopId: string) {
    return this.pontoService.reauthorize(coopId);
  }

  @Put('settings')
  @RequirePermission('canManageSettings')
  @ApiOperation({ summary: 'Update Ponto settings' })
  async updateSettings(
    @Param('coopId') coopId: string,
    @Body() dto: UpdatePontoSettingsDto,
  ) {
    return this.prisma.coop.update({
      where: { id: coopId },
      data: { autoMatchPayments: dto.autoMatchPayments },
      select: { autoMatchPayments: true },
    });
  }
}
```

**Step 4: Commit**

```bash
git add apps/api/src/modules/ponto/
git commit -m "feat(ponto): add OAuth callback, webhook, and admin controllers"
```

---

### Task 5: Ponto Queue Processor & Module Registration

**Files:**
- Create: `apps/api/src/modules/ponto/ponto.processor.ts`
- Create: `apps/api/src/modules/ponto/ponto.module.ts`
- Modify: `apps/api/src/app.module.ts`

**Step 1: Create Bull processor**

```typescript
// apps/api/src/modules/ponto/ponto.processor.ts
import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import * as Sentry from '@sentry/node';
import { PontoService } from './ponto.service';

@Processor('ponto')
export class PontoProcessor {
  private readonly logger = new Logger(PontoProcessor.name);

  constructor(private readonly pontoService: PontoService) {}

  @Process('process-transactions')
  async handleProcessTransactions(
    job: Job<{ synchronizationId: string; accountId: string }>,
  ) {
    return Sentry.withIsolationScope(async (scope) => {
      scope.setTag('queue', 'ponto');
      scope.setTag('job', 'process-transactions');

      const { synchronizationId, accountId } = job.data;
      this.logger.log(
        `Processing transactions for sync ${synchronizationId}, account ${accountId}`,
      );

      await this.pontoService.processNewTransactions(synchronizationId, accountId);
    });
  }

  @Process('health-check')
  async handleHealthCheck() {
    return Sentry.withIsolationScope(async (scope) => {
      scope.setTag('queue', 'ponto');
      scope.setTag('job', 'health-check');

      this.logger.log('Running Ponto connection health check');
      await this.pontoService.checkConnectionHealth();
    });
  }
}
```

**Step 2: Create module**

```typescript
// apps/api/src/modules/ponto/ponto.module.ts
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ScheduleModule } from '@nestjs/schedule';
import { PontoClient } from './ponto.client';
import { PontoService } from './ponto.service';
import { PontoController } from './ponto.controller';
import { PontoAdminController } from './ponto.admin.controller';
import { PontoProcessor } from './ponto.processor';
import { PontoScheduler } from './ponto.scheduler';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'ponto' }),
    EmailModule,
  ],
  controllers: [PontoController, PontoAdminController],
  providers: [PontoClient, PontoService, PontoProcessor, PontoScheduler],
  exports: [PontoService],
})
export class PontoModule {}
```

**Step 3: Create scheduler for daily health check**

```typescript
// apps/api/src/modules/ponto/ponto.scheduler.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';

@Injectable()
export class PontoScheduler {
  private readonly logger = new Logger(PontoScheduler.name);

  constructor(@InjectQueue('ponto') private readonly pontoQueue: Queue) {}

  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async handleDailyHealthCheck() {
    this.logger.log('Scheduling daily Ponto health check');
    await this.pontoQueue.add('health-check', {});
  }
}
```

**Step 4: Register in app.module.ts**

Add import and module registration in `apps/api/src/app.module.ts`:

```typescript
import { PontoModule } from './modules/ponto/ponto.module';
// Add PontoModule to imports array
```

**Step 5: Ensure BankTransaction.bankImportId is nullable**

Check the schema — `bankImportId` is currently required on `BankTransaction`. It must be made optional since Ponto-sourced transactions have no bank import. In `schema.prisma`, change:

```prisma
bankImportId String?    // Was: bankImportId String
bankImport   BankImport? @relation(fields: [bankImportId], references: [id])
```

**Step 6: Run Prisma generate + migration**

Run:
```bash
cd packages/database && npx prisma migrate dev --name make_bank_import_id_nullable
```

**Step 7: Commit**

```bash
git add apps/api/src/modules/ponto/ apps/api/src/app.module.ts packages/database/prisma/
git commit -m "feat(ponto): add module, queue processor, scheduler, and register in app"
```

---

### Task 6: System Admin — Ponto Toggle

**Files:**
- Modify: `apps/api/src/modules/coops/dto/update-coop.dto.ts` (add `pontoEnabled`)
- Modify: `apps/api/src/modules/admin/admin.controller.ts` (gate `pontoEnabled` to SYSTEM_ADMIN)
- Modify: system admin frontend page (add toggle)

**Step 1: Add pontoEnabled to UpdateCoopDto**

In `apps/api/src/modules/coops/dto/update-coop.dto.ts`, add:

```typescript
@ApiProperty({ required: false })
@IsOptional()
@IsBoolean()
pontoEnabled?: boolean;
```

**Step 2: Gate pontoEnabled to SYSTEM_ADMIN in admin controller**

In `apps/api/src/modules/admin/admin.controller.ts`, in the `updateSettings` method, add alongside the existing `emailEnabled` gate:

```typescript
if (user.role !== 'SYSTEM_ADMIN') {
  delete updateCoopDto.emailEnabled;
  delete updateCoopDto.pontoEnabled;
}
```

**Step 3: Add toggle in system admin coop management UI**

Find the system admin coop edit page/modal and add a "Ponto enabled" toggle checkbox, following the same pattern as other coop settings toggles.

**Step 4: Commit**

```bash
git add apps/api/src/modules/ apps/web/src/
git commit -m "feat(admin): add system admin toggle for Ponto feature"
```

---

### Task 7: Frontend — Bank Connection Settings Card

**Files:**
- Modify: `apps/web/src/app/[locale]/dashboard/admin/settings/page.tsx`

**Step 1: Add Ponto connection state and fetch**

Add to the settings page component:
- State: `pontoStatus` (from `GET /admin/coops/:coopId/ponto/status`)
- Fetch on mount alongside existing settings fetch
- Handle `?ponto=connected` query param to show success toast

**Step 2: Add Bank Connection card**

After existing settings cards, add a "Bank Connection" card (only when `pontoStatus.pontoEnabled` is true):

- **Disconnected**: Shows description text + "Connect bank account" button
  - Button calls `GET /admin/coops/:coopId/ponto/connect` → redirects to `authorizationUrl`
- **Connected**: Shows IBAN (masked: `BE71 **** **** 6769`), bank name, last sync time, status badge
  - "Disconnect" button (with confirmation dialog)
  - "Re-authorize" button (when status is EXPIRED or nearing expiry)
- **Toggle**: "Automatically register matched payments" → `PUT /admin/coops/:coopId/ponto/settings`

**Step 3: Add expiry banner**

At the top of the settings page (or dashboard layout), show a warning banner when connection status is EXPIRED or `authExpiresAt` is within 7 days.

**Step 4: Add translations**

Add to all 4 locale files (`apps/web/messages/{en,nl,fr,de}.json`):

```json
{
  "settings": {
    "bankConnection": "Bank Connection",
    "bankConnectionDescription": "Connect your bank account to automatically detect payments from shareholders.",
    "connectBankAccount": "Connect bank account",
    "disconnectBankAccount": "Disconnect",
    "reauthorize": "Re-authorize",
    "connected": "Connected",
    "expired": "Expired",
    "lastSync": "Last sync",
    "autoMatchPayments": "Automatically register matched payments",
    "autoMatchDescription": "When enabled, payments matching an OGM code will be automatically registered. When disabled, an admin must confirm each match.",
    "connectionExpiring": "Your bank connection expires in {days} days. Re-authorize to continue automatic payment matching.",
    "connectionExpired": "Your bank connection has expired. Re-authorize to resume automatic payment matching.",
    "pontoConnected": "Bank account connected successfully."
  }
}
```

**Step 5: Commit**

```bash
git add apps/web/
git commit -m "feat(web): add bank connection settings card with Ponto OAuth"
```

---

### Task 8: Frontend — Unmatched Payments Tab

**Files:**
- Modify: `apps/web/src/app/[locale]/dashboard/admin/transactions/page.tsx`
- Modify: `apps/api/src/modules/admin/admin.controller.ts` (add unmatched transactions endpoint)

**Step 1: Add API endpoint for unmatched Ponto transactions**

In admin controller, add:

```typescript
@Get('bank-transactions/unmatched')
@RequirePermission('canManageTransactions')
@ApiOperation({ summary: 'Get unmatched Ponto bank transactions' })
async getUnmatchedTransactions(@Param('coopId') coopId: string) {
  return this.prisma.bankTransaction.findMany({
    where: {
      coopId,
      matchStatus: 'UNMATCHED',
      pontoTransactionId: { not: null }, // Only Ponto-sourced
      amount: { gt: 0 }, // Only incoming
    },
    orderBy: { date: 'desc' },
  });
}
```

**Step 2: Add "Unmatched payments" tab to transactions page**

Add a tab/filter option alongside existing status filters. Show:
- Date, amount, counterparty name, reference text
- "Match" button → opens dialog to search/select a PENDING_PAYMENT or ACTIVE registration
- Uses existing manual match endpoint: `PUT /admin/coops/:coopId/bank-transactions/:id/match`

**Step 3: Add "Pending confirmation" tab (for coops with autoMatchPayments=false)**

Show auto-matched transactions awaiting admin confirmation:
- Date, amount, counterparty, matched registration (shareholder name, share class, quantity)
- "Confirm" and "Reject" buttons
- Confirm calls existing payment creation flow
- Reject marks the bank transaction back to UNMATCHED

**Step 4: Add translations**

```json
{
  "transactions": {
    "unmatchedPayments": "Unmatched payments",
    "pendingConfirmation": "Pending confirmation",
    "matchToRegistration": "Match to registration",
    "confirmMatch": "Confirm",
    "rejectMatch": "Reject",
    "noUnmatchedPayments": "No unmatched payments.",
    "noPendingConfirmations": "No payments pending confirmation."
  }
}
```

**Step 5: Commit**

```bash
git add apps/api/src/modules/ apps/web/
git commit -m "feat: add unmatched payments tab and pending confirmation for Ponto"
```

---

### Task 9: End-to-End Testing & Cleanup

**Files:**
- All ponto module files

**Step 1: Run full test suite**

Run: `cd apps/api && pnpm test`
Expected: All tests pass

**Step 2: Run build**

Run: `pnpm build`
Expected: No build errors

**Step 3: Test OAuth flow manually (sandbox)**

1. Set up Ponto sandbox credentials in `.env`
2. Start dev servers: `pnpm dev`
3. Enable Ponto for a test coop via system admin
4. Click "Connect bank account" → complete OAuth flow
5. Verify connection shows as ACTIVE

**Step 4: Test webhook processing manually (sandbox)**

1. Create a sandbox transaction with a known OGM code via Ponto sandbox API
2. Trigger a sync
3. Verify the webhook fires and transaction is matched
4. Verify Payment record created and Registration status updated

**Step 5: Final commit**

```bash
git add .
git commit -m "test: verify Ponto integration end-to-end"
```

---

## Dependency Graph

```
Task 1 (Schema) → Task 2 (Client) → Task 3 (Service) → Task 4 (Controllers) → Task 5 (Module) → Task 6 (System Admin UI) → Task 7 (Settings UI) → Task 8 (Unmatched Tab) → Task 9 (E2E)
```

All tasks are sequential — each builds on the previous.
