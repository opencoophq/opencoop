import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Data-retention cron. Prunes clearly-dead data on a daily schedule to avoid
 * unbounded table growth (audit findings P6/P7):
 *   - Expired auth/invitation tokens (no value once past expiry).
 *   - Operational email logs older than EMAIL_LOG_RETENTION_DAYS (default 180).
 *
 * Deliberately leaves anything with compliance/audit value untouched —
 * notably AuditLog and all business data (registrations, payments,
 * shareholders, dividends, bank transactions, etc.).
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(private readonly prisma: PrismaService) {}

  private get emailLogRetentionDays(): number {
    const parsed = Number(process.env.EMAIL_LOG_RETENTION_DAYS);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 180;
  }

  @Cron('0 3 * * *', { timeZone: 'Europe/Brussels' })
  async pruneExpiredData(): Promise<void> {
    const now = new Date();
    this.logger.log('Starting data-retention prune');

    // --- Expired tokens (clearly dead weight) ---
    await this.pruneTable('refreshToken', () =>
      this.prisma.refreshToken.deleteMany({ where: { expiresAt: { lt: now } } }),
    );
    await this.pruneTable('magicLinkToken', () =>
      this.prisma.magicLinkToken.deleteMany({ where: { expiresAt: { lt: now } } }),
    );
    await this.pruneTable('shareholderEmancipationToken', () =>
      this.prisma.shareholderEmancipationToken.deleteMany({
        where: { expiresAt: { lt: now } },
      }),
    );
    await this.pruneTable('adminInvitation', () =>
      this.prisma.adminInvitation.deleteMany({ where: { expiresAt: { lt: now } } }),
    );

    // --- Operational email logs older than the retention window ---
    const emailCutoff = new Date(
      now.getTime() - this.emailLogRetentionDays * 24 * 60 * 60 * 1000,
    );
    await this.pruneTable('emailLog', () =>
      this.prisma.emailLog.deleteMany({ where: { createdAt: { lt: emailCutoff } } }),
    );

    this.logger.log('Data-retention prune complete');
  }

  /**
   * Runs a single deleteMany, logging the deleted count and swallowing errors
   * so one failing table never aborts the rest of the run.
   */
  private async pruneTable(
    label: string,
    op: () => Promise<{ count: number }>,
  ): Promise<void> {
    try {
      const { count } = await op();
      this.logger.log(`Pruned ${count} row(s) from ${label}`);
    } catch (err) {
      this.logger.error(
        `Failed to prune ${label}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
