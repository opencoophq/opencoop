import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes, createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { PontoClient, PontoTransaction } from './ponto.client';
import { PaymentsService } from '../payments/payments.service';
import { EmailService } from '../email/email.service';
import { encryptField, decryptField } from '../../common/crypto/field-encryption';

@Injectable()
export class PontoService {
  private readonly logger = new Logger(PontoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pontoClient: PontoClient,
    private readonly paymentsService: PaymentsService,
    private readonly emailService: EmailService,
  ) {}

  // -------------------------------------------------------------------------
  // OAuth Flow
  // -------------------------------------------------------------------------

  /**
   * Initiate a Ponto bank connection for a coop.
   * Creates a PENDING PontoConnection and returns the OAuth authorization URL.
   */
  async initiateConnection(coopId: string): Promise<{ authorizationUrl: string }> {
    const coop = await this.prisma.coop.findUnique({ where: { id: coopId } });
    if (!coop) {
      throw new NotFoundException('Coop not found');
    }
    if (!coop.pontoEnabled) {
      throw new BadRequestException('Ponto is not enabled for this cooperative');
    }

    // Check for existing connection
    const existing = await this.prisma.pontoConnection.findUnique({
      where: { coopId },
    });

    if (existing) {
      if (existing.status === 'ACTIVE') {
        throw new BadRequestException(
          'An active Ponto connection already exists. Disconnect first.',
        );
      }
      // Delete stale PENDING/EXPIRED/REVOKED connection
      await this.prisma.pontoConnection.delete({ where: { id: existing.id } });
    }

    // Generate PKCE
    const codeVerifier = randomBytes(32).toString('base64url');
    const codeChallenge = createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');

    // Generate state for CSRF protection
    const state = randomBytes(16).toString('hex');

    // Store PKCE verifier and state in the connection record (encrypted)
    // accessToken field temporarily holds the codeVerifier
    // refreshToken field temporarily holds the state
    await this.prisma.pontoConnection.create({
      data: {
        coopId,
        accessToken: encryptField(codeVerifier),
        refreshToken: encryptField(state),
        tokenExpiresAt: new Date(0), // placeholder
        status: 'PENDING',
      },
    });

    const redirectUri =
      process.env.PONTO_REDIRECT_URI ||
      `${process.env.API_URL || 'http://localhost:3001'}/admin/ponto/callback`;

    const authorizationUrl = this.pontoClient.generateAuthorizationUrl(
      redirectUri,
      codeChallenge,
      state,
    );

    return { authorizationUrl };
  }

  /**
   * Handle OAuth callback by looking up the PENDING connection that matches the state parameter.
   * Returns the coopId so the caller can redirect the admin back to the right dashboard.
   */
  async handleCallbackByState(code: string, state: string): Promise<string> {
    // Find the PENDING connection that matches this state
    const connections = await this.prisma.pontoConnection.findMany({
      where: { status: 'PENDING' },
    });

    let matchedConnection: (typeof connections)[0] | null = null;
    for (const conn of connections) {
      try {
        const storedState = decryptField(conn.refreshToken);
        if (storedState === state) {
          matchedConnection = conn;
          break;
        }
      } catch {
        // Skip connections with invalid encrypted data
        continue;
      }
    }

    if (!matchedConnection) {
      throw new BadRequestException('Invalid or expired OAuth state');
    }

    // Extract the code verifier
    const codeVerifier = decryptField(matchedConnection.accessToken);

    await this.handleCallback(matchedConnection.id, code, codeVerifier);

    return matchedConnection.coopId;
  }

  /**
   * Complete the OAuth flow: exchange authorization code for tokens,
   * fetch accounts, and activate the connection.
   */
  async handleCallback(
    connectionId: string,
    code: string,
    codeVerifier: string,
  ): Promise<void> {
    const redirectUri =
      process.env.PONTO_REDIRECT_URI ||
      `${process.env.API_URL || 'http://localhost:3001'}/admin/ponto/callback`;

    const tokens = await this.pontoClient.exchangeAuthorizationCode(
      code,
      codeVerifier,
      redirectUri,
    );

    // Fetch available bank accounts
    const accounts = await this.pontoClient.getAccounts(tokens.accessToken);
    const account = accounts[0] ?? null;

    // Activate the connection with real tokens and account info
    await this.prisma.pontoConnection.update({
      where: { id: connectionId },
      data: {
        accessToken: encryptField(tokens.accessToken),
        refreshToken: encryptField(tokens.refreshToken),
        tokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000),
        pontoAccountId: account?.id ?? null,
        iban: account?.iban ?? null,
        bankName: account?.financialInstitutionName ?? null,
        status: 'ACTIVE',
        authExpiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days
      },
    });

    this.logger.log(
      `Ponto connection ${connectionId} activated` +
        (account ? ` — IBAN ${account.iban} (${account.financialInstitutionName})` : ''),
    );
  }

  /**
   * Disconnect the Ponto bank connection for a coop.
   * Revokes the token (best effort) and deletes the connection record.
   */
  async disconnect(coopId: string): Promise<void> {
    const connection = await this.prisma.pontoConnection.findUnique({
      where: { coopId },
    });

    if (!connection) {
      throw new NotFoundException('No Ponto connection found for this cooperative');
    }

    // Best-effort revoke
    try {
      const token = decryptField(connection.accessToken);
      await this.pontoClient.revokeToken(token);
    } catch (err) {
      this.logger.warn(
        `Failed to revoke Ponto token for coop ${coopId}: ${(err as Error).message}`,
      );
    }

    await this.prisma.pontoConnection.delete({ where: { id: connection.id } });
    this.logger.log(`Ponto connection disconnected for coop ${coopId}`);
  }

  /**
   * Get the current Ponto connection status for a coop.
   * Returns connection info or null if not connected.
   */
  async getConnectionStatus(coopId: string) {
    const connection = await this.prisma.pontoConnection.findUnique({
      where: { coopId },
    });

    if (!connection) {
      return null;
    }

    return {
      id: connection.id,
      status: connection.status,
      iban: connection.iban,
      bankName: connection.bankName,
      lastSyncAt: connection.lastSyncAt,
      authExpiresAt: connection.authExpiresAt,
      createdAt: connection.createdAt,
    };
  }

  /**
   * Reauthorize an expired or revoked Ponto connection.
   * Deletes the old connection and initiates a fresh one.
   */
  async reauthorize(coopId: string): Promise<{ authorizationUrl: string }> {
    const existing = await this.prisma.pontoConnection.findUnique({
      where: { coopId },
    });

    if (existing) {
      // Best-effort revoke before deleting
      try {
        const token = decryptField(existing.accessToken);
        await this.pontoClient.revokeToken(token);
      } catch {
        // Ignore — token may already be invalid
      }
      await this.prisma.pontoConnection.delete({ where: { id: existing.id } });
    }

    return this.initiateConnection(coopId);
  }

  // -------------------------------------------------------------------------
  // Transaction Processing
  // -------------------------------------------------------------------------

  /**
   * Process new transactions from a Ponto synchronization.
   * Fetches updated transactions, filters for incoming payments, and processes each.
   */
  async processNewTransactions(
    synchronizationId: string,
    pontoAccountId: string,
  ): Promise<void> {
    const connection = await this.prisma.pontoConnection.findFirst({
      where: { pontoAccountId, status: 'ACTIVE' },
      include: { coop: true },
    });

    if (!connection) {
      throw new NotFoundException(
        `No active Ponto connection found for account ${pontoAccountId}`,
      );
    }

    const accessToken = await this.pontoClient.getValidAccessToken(connection.id);
    const transactions = await this.pontoClient.getUpdatedTransactions(
      accessToken,
      synchronizationId,
    );

    // Only process incoming (positive) transactions
    const incoming = transactions.filter((tx) => tx.amount > 0);

    this.logger.log(
      `Processing ${incoming.length} incoming transactions ` +
        `(${transactions.length} total) for coop ${connection.coopId}`,
    );

    const autoMatch = connection.coop?.autoMatchPayments ?? true;

    for (const txn of incoming) {
      await this.processTransaction(txn, connection.coopId, autoMatch);
    }

    // Update last sync timestamp
    await this.prisma.pontoConnection.update({
      where: { id: connection.id },
      data: { lastSyncAt: new Date() },
    });
  }

  /**
   * Process a single bank transaction: dedup, extract OGM, match to registration,
   * create BankTransaction record, and optionally create a Payment.
   */
  private async processTransaction(
    txn: PontoTransaction,
    coopId: string,
    autoMatch: boolean,
  ): Promise<void> {
    // Deduplication: skip if we've already seen this Ponto transaction
    const existing = await this.prisma.bankTransaction.findUnique({
      where: { pontoTransactionId: txn.id },
    });
    if (existing) {
      this.logger.debug(`Skipping duplicate Ponto transaction ${txn.id}`);
      return;
    }

    // Extract OGM code from structured remittance information
    let ogmCode: string | null = null;
    if (txn.remittanceInformationType === 'structured') {
      ogmCode = txn.remittanceInformation.replace(/\D/g, '');
      // Validate it looks like a 12-digit OGM
      if (!/^\d{12}$/.test(ogmCode)) {
        ogmCode = null;
      }
    }

    // Try to match to a registration
    let registration: {
      id: string;
      coopId: string;
      shareholder: {
        id: string;
        firstName: string | null;
        lastName: string | null;
        email: string | null;
      };
    } | null = null;
    if (ogmCode) {
      registration = await this.prisma.registration.findFirst({
        where: {
          ogmCode,
          coopId,
          status: { in: ['PENDING_PAYMENT', 'ACTIVE'] },
        },
        include: {
          payments: true,
          shareholder: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      });
    }

    const matchStatus = registration ? 'AUTO_MATCHED' : 'UNMATCHED';

    // Create the BankTransaction record
    const bankTransaction = await this.prisma.bankTransaction.create({
      data: {
        coopId,
        bankImportId: null,
        date: new Date(txn.executionDate || txn.valueDate),
        amount: txn.amount,
        counterparty: txn.counterpartName || null,
        ogmCode,
        referenceText: txn.remittanceInformation || null,
        pontoTransactionId: txn.id,
        matchStatus,
      },
    });

    if (registration && autoMatch) {
      await this.createPaymentFromTransaction(
        bankTransaction,
        registration,
        coopId,
        txn.amount,
        new Date(txn.executionDate || txn.valueDate),
      );
    } else if (registration && !autoMatch) {
      this.logger.log(
        `Transaction ${txn.id} matched registration ${registration.id} — ` +
          `pending admin confirmation (autoMatch disabled)`,
      );
    } else {
      this.logger.log(`Transaction ${txn.id} unmatched — no OGM or registration found`);
    }
  }

  /**
   * Create a Payment from a matched bank transaction and send confirmation email.
   */
  private async createPaymentFromTransaction(
    bankTransaction: { id: string },
    registration: {
      id: string;
      coopId: string;
      shareholder: {
        id: string;
        firstName: string | null;
        lastName: string | null;
        email: string | null;
      };
    },
    coopId: string,
    amount: number,
    bankDate: Date,
  ): Promise<void> {
    try {
      await this.paymentsService.addPayment({
        registrationId: registration.id,
        coopId,
        amount,
        bankDate,
        bankTransactionId: bankTransaction.id,
      });

      this.logger.log(
        `Payment created for registration ${registration.id} from Ponto transaction`,
      );

      // Send confirmation email if shareholder has an email
      const { shareholder } = registration;
      if (shareholder.email) {
        const shareholderName =
          [shareholder.firstName, shareholder.lastName].filter(Boolean).join(' ') ||
          'Shareholder';

        try {
          await this.emailService.sendPaymentConfirmation(coopId, shareholder.email, {
            shareholderName,
            amount,
          });
        } catch (emailErr) {
          this.logger.warn(
            `Failed to send payment confirmation email to ${shareholder.email}: ` +
              `${(emailErr as Error).message}`,
          );
        }
      }
    } catch (err) {
      this.logger.error(
        `Failed to create payment for registration ${registration.id}: ` +
          `${(err as Error).message}`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Health Check
  // -------------------------------------------------------------------------

  /**
   * Check all active Ponto connections for expiry and staleness.
   * - Marks connections as EXPIRED if authExpiresAt has passed
   * - Sends warning emails to coop admins when expiry is <7 days away
   * - Logs warnings for connections that haven't synced in >24 hours
   */
  async checkConnectionHealth(): Promise<void> {
    const connections = await this.prisma.pontoConnection.findMany({
      where: { status: 'ACTIVE' },
      include: {
        coop: {
          include: {
            admins: {
              include: { user: true },
            },
          },
        },
      },
    });

    const now = new Date();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const twentyFourHoursMs = 24 * 60 * 60 * 1000;

    for (const conn of connections) {
      if (!conn.authExpiresAt) continue;

      const timeUntilExpiry = conn.authExpiresAt.getTime() - now.getTime();

      // Already expired
      if (timeUntilExpiry <= 0) {
        await this.prisma.pontoConnection.update({
          where: { id: conn.id },
          data: { status: 'EXPIRED' },
        });
        this.logger.warn(
          `Ponto connection for coop ${conn.coop.name} (${conn.coopId}) has expired`,
        );
        continue;
      }

      // Expiring within 7 days and not yet notified
      if (timeUntilExpiry < sevenDaysMs && !conn.expiryNotifiedAt) {
        const daysRemaining = Math.ceil(timeUntilExpiry / (24 * 60 * 60 * 1000));

        // Notify each coop admin
        for (const admin of conn.coop.admins) {
          try {
            await this.emailService.send({
              coopId: conn.coopId,
              to: admin.user.email,
              subject: `Ponto bank connection expiring in ${daysRemaining} days`,
              templateKey: 'ponto-expiry-warning',
              templateData: {
                coopName: conn.coop.name,
                daysRemaining,
                bankName: conn.bankName,
                iban: conn.iban,
              },
            });
          } catch (emailErr) {
            this.logger.warn(
              `Failed to send expiry notification to ${admin.user.email}: ` +
                `${(emailErr as Error).message}`,
            );
          }
        }

        await this.prisma.pontoConnection.update({
          where: { id: conn.id },
          data: { expiryNotifiedAt: now },
        });

        this.logger.warn(
          `Ponto connection for coop ${conn.coop.name} expires in ${daysRemaining} days — admins notified`,
        );
      }

      // Check sync staleness
      if (conn.lastSyncAt) {
        const sinceSyncMs = now.getTime() - conn.lastSyncAt.getTime();
        if (sinceSyncMs > twentyFourHoursMs) {
          const hoursStale = Math.round(sinceSyncMs / (60 * 60 * 1000));
          this.logger.warn(
            `Ponto connection for coop ${conn.coop.name} hasn't synced in ${hoursStale} hours`,
          );
        }
      }
    }
  }
}
