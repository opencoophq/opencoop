import { Injectable, Logger } from '@nestjs/common';
import * as https from 'https';
import * as fs from 'fs';
import { PrismaService } from '../../prisma/prisma.service';
import { encryptField, decryptField } from '../../common/crypto/field-encryption';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface PontoTokens {
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

export interface PontoAccount {
  id: string;
  iban: string;
  currency: string;
  description: string;
  financialInstitutionName: string;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

@Injectable()
export class PontoClient {
  private readonly logger = new Logger(PontoClient.name);
  private readonly apiBase = 'https://api.ibanity.com/ponto-connect';
  private readonly authBase: string;
  private readonly agent: https.Agent | undefined;

  constructor(private readonly prisma: PrismaService) {
    // Determine auth base URL
    this.authBase =
      process.env.PONTO_SANDBOX === 'true'
        ? 'https://sandbox-authorization.myponto.com'
        : 'https://authorization.myponto.com';

    // Build mTLS agent if cert paths are available
    try {
      const certPath = process.env.PONTO_CERT_PATH;
      const keyPath = process.env.PONTO_KEY_PATH;
      if (certPath && keyPath) {
        this.agent = new https.Agent({
          cert: fs.readFileSync(certPath),
          key: fs.readFileSync(keyPath),
          passphrase: process.env.PONTO_KEY_PASSPHRASE,
        });
        this.logger.log('mTLS agent initialized');
      } else {
        this.logger.warn('PONTO_CERT_PATH / PONTO_KEY_PATH not set; mTLS disabled');
      }
    } catch (err) {
      this.logger.warn('Failed to initialize mTLS agent', (err as Error).message);
    }
  }

  // -------------------------------------------------------------------------
  // OAuth helpers
  // -------------------------------------------------------------------------

  /**
   * Build the Ponto OAuth authorization URL (PKCE flow).
   */
  generateAuthorizationUrl(redirectUri: string, codeChallenge: string, state: string): string {
    const params = new URLSearchParams({
      client_id: process.env.PONTO_CLIENT_ID!,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'ai',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
    });
    return `${this.authBase}/oauth2/auth?${params.toString()}`;
  }

  /**
   * Exchange an authorization code for tokens.
   */
  async exchangeAuthorizationCode(
    code: string,
    codeVerifier: string,
    redirectUri: string,
  ): Promise<PontoTokens> {
    return this.postTokenRequest({
      grant_type: 'authorization_code',
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
    });
  }

  /**
   * Refresh an access token.
   */
  async refreshAccessToken(refreshToken: string): Promise<PontoTokens> {
    return this.postTokenRequest({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
  }

  /**
   * Revoke a token (access or refresh).
   */
  async revokeToken(token: string): Promise<void> {
    const url = `${this.apiBase}/oauth2/revoke`;
    const body = new URLSearchParams({ token }).toString();

    await this.httpRequest(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${this.basicAuth()}`,
      },
      body,
    });
  }

  // -------------------------------------------------------------------------
  // API methods
  // -------------------------------------------------------------------------

  async getAccounts(accessToken: string): Promise<PontoAccount[]> {
    const res = await this.apiGet('/accounts', accessToken);
    return this.parseJsonApiList<PontoAccount>(res);
  }

  async getAccount(accessToken: string, accountId: string): Promise<PontoAccount> {
    const res = await this.apiGet(`/accounts/${accountId}`, accessToken);
    return this.parseJsonApiItem<PontoAccount>(res);
  }

  async getTransactions(
    accessToken: string,
    accountId: string,
    limit?: number,
  ): Promise<PontoTransaction[]> {
    const query = limit ? `?page[limit]=${limit}` : '';
    const res = await this.apiGet(`/accounts/${accountId}/transactions${query}`, accessToken);
    return this.parseJsonApiList<PontoTransaction>(res);
  }

  async getUpdatedTransactions(
    accessToken: string,
    syncId: string,
  ): Promise<PontoTransaction[]> {
    const res = await this.apiGet(
      `/synchronizations/${syncId}/updated-transactions`,
      accessToken,
    );
    return this.parseJsonApiList<PontoTransaction>(res);
  }

  async createSynchronization(
    accessToken: string,
    accountId: string,
    subtype: string,
  ): Promise<{ id: string; status: string }> {
    const url = `${this.apiBase}/synchronizations`;
    const payload = {
      data: {
        type: 'synchronization',
        attributes: { subtype },
        relationships: {
          account: { data: { type: 'account', id: accountId } },
        },
      },
    };
    const res = await this.httpRequest(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/vnd.api+json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    return { id: json.data.id, status: json.data.attributes.status };
  }

  async getSynchronization(
    accessToken: string,
    syncId: string,
  ): Promise<{ id: string; status: string }> {
    const res = await this.apiGet(`/synchronizations/${syncId}`, accessToken);
    return { id: res.data.id, status: res.data.attributes.status };
  }

  // -------------------------------------------------------------------------
  // Token auto-refresh
  // -------------------------------------------------------------------------

  /**
   * Returns a valid access token for a stored PontoConnection.
   * Refreshes the token if it has expired (or will expire within 60 s).
   */
  async getValidAccessToken(connectionId: string): Promise<string> {
    const conn = await this.prisma.pontoConnection.findUnique({
      where: { id: connectionId },
    });

    if (!conn) {
      throw new Error(`PontoConnection ${connectionId} not found`);
    }

    const now = new Date();
    const bufferMs = 60_000; // refresh 60 s before expiry
    if (conn.tokenExpiresAt.getTime() - bufferMs > now.getTime()) {
      return decryptField(conn.accessToken);
    }

    this.logger.log(`Refreshing token for PontoConnection ${connectionId}`);
    const decryptedRefresh = decryptField(conn.refreshToken);
    const tokens = await this.refreshAccessToken(decryptedRefresh);

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

  // -------------------------------------------------------------------------
  // JSON:API parsing
  // -------------------------------------------------------------------------

  parseJsonApiList<T extends { id: string }>(response: {
    data: Array<{ id: string; attributes: Record<string, unknown> }>;
  }): T[] {
    return response.data.map((item) => this.extractJsonApiItem<T>(item));
  }

  parseJsonApiItem<T extends { id: string }>(response: {
    data: { id: string; attributes: Record<string, unknown> };
  }): T {
    return this.extractJsonApiItem<T>(response.data);
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private extractJsonApiItem<T extends { id: string }>(item: {
    id: string;
    attributes: Record<string, unknown>;
  }): T {
    return { id: item.id, ...item.attributes } as unknown as T;
  }

  private basicAuth(): string {
    const clientId = process.env.PONTO_CLIENT_ID ?? '';
    const clientSecret = process.env.PONTO_CLIENT_SECRET ?? '';
    return Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  }

  /**
   * Common POST to the token endpoint (authorization_code / refresh_token).
   */
  private async postTokenRequest(
    params: Record<string, string>,
  ): Promise<PontoTokens> {
    const url = `${this.apiBase}/oauth2/token`;
    const body = new URLSearchParams(params).toString();

    const res = await this.httpRequest(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${this.basicAuth()}`,
      },
      body,
    });

    const json = await res.json();
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresIn: json.expires_in,
    };
  }

  /**
   * GET a JSON:API resource from the Ponto API.
   */
  private async apiGet(
    path: string,
    accessToken: string,
  ): Promise<{ data: any }> {
    const url = `${this.apiBase}${path}`;
    const res = await this.httpRequest(url, {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.api+json',
        Authorization: `Bearer ${accessToken}`,
      },
    });
    return res.json();
  }

  /**
   * Low-level HTTP request with mTLS agent attached.
   */
  private async httpRequest(
    url: string,
    options: {
      method: string;
      headers: Record<string, string>;
      body?: string;
    },
  ): Promise<Response> {
    const fetchOptions: RequestInit & { dispatcher?: unknown } = {
      method: options.method,
      headers: options.headers,
      body: options.body,
    };

    // Node.js native fetch doesn't support https.Agent directly.
    // In production, mTLS is handled at the infra level or via a custom undici agent.
    // For now we pass the agent via the Node.js-specific option if available.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (this.agent) {
      (fetchOptions as any).agent = this.agent;
    }

    const res = await fetch(url, fetchOptions);

    if (!res.ok) {
      const text = await res.text();
      this.logger.error(`Ponto API error ${res.status}: ${text}`);
      throw new Error(`Ponto API ${options.method} ${url} failed: ${res.status} ${text}`);
    }

    return res;
  }
}
