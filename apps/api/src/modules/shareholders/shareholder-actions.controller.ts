import {
  Controller,
  Post,
  Put,
  Body,
  Param,
  UseGuards,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { TransactionsService } from '../transactions/transactions.service';
import { IsString, IsInt, IsOptional, Min } from 'class-validator';

class SellRequestDto {
  @IsString()
  shareId: string;

  @IsInt()
  @Min(1)
  quantity: number;
}

class UpdateBankDetailsDto {
  @IsString()
  bankIban: string;

  @IsOptional()
  @IsString()
  bankBic?: string;
}

@ApiTags('shareholder-actions')
@Controller('shareholders/:shareholderId')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ShareholderActionsController {
  constructor(
    private prisma: PrismaService,
    private transactionsService: TransactionsService,
  ) {}

  private async verifyShareholder(shareholderId: string, userId: string) {
    const shareholder = await this.prisma.shareholder.findUnique({
      where: { id: shareholderId },
      include: { coop: { select: { minimumHoldingPeriod: true } } },
    });

    if (!shareholder) {
      throw new NotFoundException('Shareholder not found');
    }

    if (shareholder.userId !== userId) {
      throw new ForbiddenException('You can only manage your own shareholder records');
    }

    return shareholder;
  }

  @Post('sell-request')
  @ApiOperation({ summary: 'Request to sell shares (shareholder self-service)' })
  async sellRequest(
    @Param('shareholderId') shareholderId: string,
    @CurrentUser() user: CurrentUserData,
    @Body() dto: SellRequestDto,
  ) {
    const shareholder = await this.verifyShareholder(shareholderId, user.id);

    // Verify shareholder has bank details
    if (!shareholder.bankIban) {
      throw new BadRequestException('Bank account (IBAN) is required before selling shares');
    }

    // Verify share belongs to shareholder
    const share = await this.prisma.share.findFirst({
      where: { id: dto.shareId, shareholderId },
    });

    if (!share) {
      throw new NotFoundException('Share not found');
    }

    if (share.status !== 'ACTIVE') {
      throw new BadRequestException('Only active shares can be sold');
    }

    // Check minimum holding period
    const holdingMonths = shareholder.coop.minimumHoldingPeriod;
    if (holdingMonths > 0) {
      const purchaseDate = new Date(share.purchaseDate);
      const minDate = new Date(purchaseDate);
      minDate.setMonth(minDate.getMonth() + holdingMonths);
      if (new Date() < minDate) {
        throw new BadRequestException(
          `Minimum holding period of ${holdingMonths} months not yet reached`,
        );
      }
    }

    return this.transactionsService.createSale({
      coopId: shareholder.coopId,
      shareholderId,
      shareId: dto.shareId,
      quantity: dto.quantity,
    });
  }

  @Put('bank-details')
  @ApiOperation({ summary: 'Update shareholder bank details' })
  async updateBankDetails(
    @Param('shareholderId') shareholderId: string,
    @CurrentUser() user: CurrentUserData,
    @Body() dto: UpdateBankDetailsDto,
  ) {
    await this.verifyShareholder(shareholderId, user.id);

    return this.prisma.shareholder.update({
      where: { id: shareholderId },
      data: {
        bankIban: dto.bankIban,
        bankBic: dto.bankBic || null,
      },
      select: {
        id: true,
        bankIban: true,
        bankBic: true,
      },
    });
  }
}
