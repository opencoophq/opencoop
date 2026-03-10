import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { computeTotalPaid, computeVestedShares } from '@opencoop/shared';

@Injectable()
export class ExternalApiService {
  constructor(private prisma: PrismaService) {}

  async queryShareholders(coopId: string, emails: string[]) {
    const shareholders = await this.prisma.shareholder.findMany({
      where: { coopId, email: { in: emails } },
      select: {
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

    const shareholderMap = new Map(shareholders.map((s) => [s.email, s]));

    return emails.map((email) => {
      const sh = shareholderMap.get(email);
      if (!sh) return { email, found: false };

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
        email,
        found: true,
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
      const shareholder = await this.prisma.shareholder.findFirst({
        where: { coopId, email: update.email },
      });
      if (!shareholder) {
        results.push({ email: update.email, success: false, error: 'not found' });
        continue;
      }
      await this.prisma.shareholder.update({
        where: { id: shareholder.id },
        data: {
          isEcoPowerClient: update.isEcoPowerClient,
          ...(update.ecoPowerId !== undefined && { ecoPowerId: update.ecoPowerId }),
        },
      });
      results.push({ email: update.email, success: true });
    }
    return results;
  }
}
