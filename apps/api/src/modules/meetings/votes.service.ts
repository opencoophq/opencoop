import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MajorityType, VotingWeight, VoteChoice } from '@opencoop/database';
import { RecordVoteDto } from './dto/record-vote.dto';

export interface OutcomeInput {
  majorityType: MajorityType;
  votesFor: number;
  votesAgainst: number;
  votesAbstain: number;
}

@Injectable()
export class VotesService {
  constructor(private prisma: PrismaService) {}

  /**
   * Pure majority math. Abstentions are excluded from both the numerator AND
   * the denominator for qualified majorities (Bronsgroen statuten Art. 25:
   * "drie vierden van de uitgebrachte stemmen... onthoudingen in de teller
   * noch in de noemer worden meegerekend"). For simple majority, a strict
   * majority of cast votes (for > against) is required — ties are rejected
   * per WVV default.
   */
  computeOutcome({ majorityType, votesFor, votesAgainst }: OutcomeInput): boolean {
    switch (majorityType) {
      case MajorityType.SIMPLE:
        return votesFor > votesAgainst;
      case MajorityType.TWO_THIRDS:
        // votesFor / (votesFor + votesAgainst) >= 2/3
        // Avoid division: 3*votesFor >= 2*(votesFor + votesAgainst)
        // Reject when no votes were cast at all.
        if (votesFor + votesAgainst === 0) return false;
        return votesFor * 3 >= (votesFor + votesAgainst) * 2;
      case MajorityType.THREE_QUARTERS:
        if (votesFor + votesAgainst === 0) return false;
        return votesFor * 4 >= (votesFor + votesAgainst) * 3;
    }
  }

  async recordVotes(coopId: string, resolutionId: string, votes: RecordVoteDto[]) {
    const resolution = await this.prisma.resolution.findUnique({
      where: { id: resolutionId },
      include: { agendaItem: { include: { meeting: true } } },
    });
    if (!resolution) throw new NotFoundException('Resolution not found');
    if (resolution.agendaItem.meeting.coopId !== coopId) {
      throw new ForbiddenException('Resolution does not belong to this coop');
    }
    if (resolution.closedAt) throw new BadRequestException('Resolution is closed');

    const meeting = resolution.agendaItem.meeting;
    const perShare = meeting.votingWeight === VotingWeight.PER_SHARE;

    // Tenant isolation: every submitted shareholderId must belong to the meeting's coop.
    const shareholderIds = [...new Set(votes.map((v) => v.shareholderId))];
    if (shareholderIds.length > 0) {
      const validShareholders = await this.prisma.shareholder.findMany({
        where: { id: { in: shareholderIds }, coopId },
        select: { id: true },
      });
      const validIds = new Set(validShareholders.map((s) => s.id));
      const invalid = shareholderIds.filter((id) => !validIds.has(id));
      if (invalid.length > 0) {
        throw new ForbiddenException(
          `Shareholder(s) do not belong to this coop: ${invalid.join(', ')}`,
        );
      }
    }

    // Validate any proxy references belong to THIS meeting and are non-revoked.
    const proxyIds = [
      ...new Set(votes.map((v) => v.castViaProxyId).filter((x): x is string => !!x)),
    ];
    if (proxyIds.length > 0) {
      const validProxies = await this.prisma.proxy.findMany({
        where: { id: { in: proxyIds }, meetingId: meeting.id, revokedAt: null },
        select: { id: true },
      });
      const validProxyIds = new Set(validProxies.map((p) => p.id));
      const invalid = proxyIds.filter((id) => !validProxyIds.has(id));
      if (invalid.length > 0) {
        throw new BadRequestException(
          `Proxy reference(s) invalid for this meeting: ${invalid.join(', ')}`,
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      for (const v of votes) {
        let weight = 1;
        if (perShare) {
          const registrations = await tx.registration.findMany({
            where: {
              shareholderId: v.shareholderId,
              status: { in: ['ACTIVE', 'COMPLETED'] },
              type: { in: ['BUY', 'SELL'] },
            },
            select: { type: true, quantity: true },
          });
          let total = 0;
          for (const r of registrations) {
            total += r.type === 'BUY' ? r.quantity : -r.quantity;
          }
          weight = Math.max(total, 1);
        }

        await tx.vote.upsert({
          where: {
            resolutionId_shareholderId: { resolutionId, shareholderId: v.shareholderId },
          },
          create: {
            resolutionId,
            shareholderId: v.shareholderId,
            choice: v.choice,
            weight,
            castViaProxyId: v.castViaProxyId,
          },
          update: {
            choice: v.choice,
            weight,
            castViaProxyId: v.castViaProxyId,
            castAt: new Date(),
          },
        });
      }

      const [forAgg, againstAgg, abstainAgg] = await Promise.all([
        tx.vote.aggregate({
          where: { resolutionId, choice: VoteChoice.FOR },
          _sum: { weight: true },
        }),
        tx.vote.aggregate({
          where: { resolutionId, choice: VoteChoice.AGAINST },
          _sum: { weight: true },
        }),
        tx.vote.aggregate({
          where: { resolutionId, choice: VoteChoice.ABSTAIN },
          _sum: { weight: true },
        }),
      ]);

      return tx.resolution.update({
        where: { id: resolutionId },
        data: {
          votesFor: forAgg._sum.weight ?? 0,
          votesAgainst: againstAgg._sum.weight ?? 0,
          votesAbstain: abstainAgg._sum.weight ?? 0,
        },
      });
    });
  }

  async closeResolution(coopId: string, resolutionId: string) {
    const r = await this.prisma.resolution.findUnique({
      where: { id: resolutionId },
      include: { agendaItem: { include: { meeting: { select: { coopId: true } } } } },
    });
    if (!r) throw new NotFoundException('Resolution not found');
    if (r.agendaItem.meeting.coopId !== coopId) {
      throw new ForbiddenException('Resolution does not belong to this coop');
    }
    if (r.closedAt) throw new BadRequestException('Resolution already closed');

    const passed = this.computeOutcome({
      majorityType: r.majorityType,
      votesFor: r.votesFor,
      votesAgainst: r.votesAgainst,
      votesAbstain: r.votesAbstain,
    });

    return this.prisma.resolution.update({
      where: { id: resolutionId },
      data: { passed, closedAt: new Date() },
    });
  }
}
