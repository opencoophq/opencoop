import { Injectable, NotFoundException } from '@nestjs/common';
import { EmancipationReason, EmancipationService } from '../auth/emancipation.service';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class HouseholdService {
  constructor(
    private prisma: PrismaService,
    private emancipationService: EmancipationService,
  ) {}

  /**
   * Initiate a household split for a shareholder: sends a claim-account email
   * to the shared-inbox user so the shareholder can set up their own login.
   */
  async unlinkShareholder(coopId: string, shareholderId: string) {
    // Verify the shareholder belongs to this coop
    const shareholder = await this.prisma.shareholder.findFirst({
      where: { id: shareholderId, coopId },
    });

    if (!shareholder) {
      throw new NotFoundException('Shareholder not found in this cooperative');
    }

    return this.emancipationService.startEmancipation({
      shareholderId,
      reason: EmancipationReason.HOUSEHOLD_SPLIT,
    });
  }
}
