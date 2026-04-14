import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { computeTotalPaid, computeVestedShares } from '@opencoop/shared';
import { resolveShareholderEmail } from '../shareholders/shareholder-email.resolver';

@Injectable()
export class ExternalApiService {
  private readonly logger = new Logger(ExternalApiService.name);

  constructor(private prisma: PrismaService) {}

  async queryShareholders(coopId: string, emails: string[]) {
    const lowerEmails = emails.map((e) => e.toLowerCase());

    const shareholders = await this.prisma.shareholder.findMany({
      where: {
        coopId,
        OR: [
          { email: { in: lowerEmails, mode: 'insensitive' } },
          { user: { email: { in: lowerEmails, mode: 'insensitive' } } },
        ],
      },
      select: {
        email: true,
        firstName: true,
        lastName: true,
        companyName: true,
        type: true,
        isEcoPowerClient: true,
        ecoPowerId: true,
        user: { select: { email: true } },
        registrations: {
          where: { status: { in: ['ACTIVE', 'COMPLETED', 'PENDING_PAYMENT'] } },
          select: {
            type: true,
            quantity: true,
            pricePerShare: true,
            status: true,
            payments: { select: { amount: true } },
          },
        },
      },
    });

    const byEmail = new Map<
      string,
      Array<{
        firstName: string | null;
        lastName: string | null;
        companyName: string | null;
        type: string;
        totalShares: number;
        totalShareValue: number;
        isEcoPowerClient: boolean;
        ecoPowerId: string | null;
      }>
    >();

    for (const sh of shareholders) {
      const resolved = resolveShareholderEmail(sh);
      if (!resolved) continue;
      const key = resolved.toLowerCase();
      if (!lowerEmails.includes(key)) continue;

      let totalShares = 0;
      let totalShareValue = 0;

      for (const reg of sh.registrations) {
        const pricePerShare = Number(reg.pricePerShare);
        if (reg.type === 'BUY') {
          const paid = computeTotalPaid(reg.payments);
          const vested = computeVestedShares(paid, pricePerShare, reg.quantity);
          totalShares += vested;
          totalShareValue += vested * pricePerShare;
        } else if (reg.type === 'SELL') {
          totalShares -= reg.quantity;
          totalShareValue -= reg.quantity * pricePerShare;
        }
      }

      const record = {
        firstName: sh.firstName,
        lastName: sh.lastName,
        companyName: sh.companyName,
        type: sh.type,
        totalShares: Math.max(0, totalShares),
        totalShareValue: Math.max(0, totalShareValue),
        isEcoPowerClient: sh.isEcoPowerClient,
        ecoPowerId: sh.ecoPowerId,
      };

      const arr = byEmail.get(key) ?? [];
      arr.push(record);
      byEmail.set(key, arr);
    }

    return emails.map((email) => ({
      email,
      shareholders: byEmail.get(email.toLowerCase()) ?? [],
    }));
  }

  async searchByName(coopId: string, name: string) {
    const terms = name.trim().split(/\s+/);
    if (terms.length === 0) return [];

    const shareholders = await this.prisma.shareholder.findMany({
      where: {
        coopId,
        AND: terms.map((term) => ({
          OR: [
            { firstName: { contains: term, mode: 'insensitive' as const } },
            { lastName: { contains: term, mode: 'insensitive' as const } },
          ],
        })),
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        companyName: true,
        type: true,
        isEcoPowerClient: true,
        ecoPowerId: true,
        registrations: {
          where: { status: { in: ['ACTIVE', 'COMPLETED', 'PENDING_PAYMENT'] } },
          select: {
            type: true,
            quantity: true,
            pricePerShare: true,
            status: true,
            payments: { select: { amount: true } },
          },
        },
      },
    });

    return shareholders.map((sh) => {
      let totalShares = 0;
      let totalShareValue = 0;

      for (const reg of sh.registrations) {
        const pricePerShare = Number(reg.pricePerShare);
        if (reg.type === 'BUY') {
          const paid = computeTotalPaid(reg.payments);
          const vested = computeVestedShares(paid, pricePerShare, reg.quantity);
          totalShares += vested;
          totalShareValue += vested * pricePerShare;
        } else if (reg.type === 'SELL') {
          totalShares -= reg.quantity;
          totalShareValue -= reg.quantity * pricePerShare;
        }
      }

      return {
        id: sh.id,
        email: sh.email,
        firstName: sh.firstName,
        lastName: sh.lastName,
        companyName: sh.companyName,
        type: sh.type,
        totalShares: Math.max(0, totalShares),
        totalShareValue: Math.max(0, totalShareValue),
        isEcoPowerClient: sh.isEcoPowerClient,
        ecoPowerId: sh.ecoPowerId,
      };
    });
  }

  async updateEcoPowerStatus(
    coopId: string,
    updates: { email: string; isEcoPowerClient: boolean; ecoPowerId?: string }[],
  ) {
    const results: { email: string; success: boolean; error?: string }[] = [];

    for (const update of updates) {
      const lowerEmail = update.email.toLowerCase();

      const matchingShareholders = await this.prisma.shareholder.findMany({
        where: {
          coopId,
          OR: [
            { email: { equals: lowerEmail, mode: 'insensitive' } },
            { user: { email: { equals: lowerEmail, mode: 'insensitive' } } },
          ],
        },
        select: { id: true, email: true, user: { select: { email: true } } },
      });

      if (matchingShareholders.length === 0) {
        results.push({ email: update.email, success: false, error: 'not found' });
        continue;
      }

      if (matchingShareholders.length > 1) {
        this.logger.warn(
          `updateEcoPowerStatus: ${matchingShareholders.length} shareholders match email "${update.email}" in coop ${coopId} — applying fan-out update to all matches`,
        );
      }

      for (const shareholder of matchingShareholders) {
        await this.prisma.shareholder.update({
          where: { id: shareholder.id },
          data: {
            isEcoPowerClient: update.isEcoPowerClient,
            ...(update.ecoPowerId !== undefined && { ecoPowerId: update.ecoPowerId }),
          },
        });
      }

      results.push({ email: update.email, success: true });
    }

    return results;
  }
}
