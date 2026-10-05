import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { ChargeCardsService } from './charge-cards.service';
import { RequestChargeCardDto } from './dto/request-charge-card.dto';

@ApiTags('charge-cards')
@ApiBearerAuth()
@Controller('shareholders/:shareholderId/charge-cards')
@UseGuards(JwtAuthGuard)
export class ChargeCardsController {
  constructor(private readonly chargeCards: ChargeCardsService) {}

  @Get()
  @ApiOperation({ summary: 'List own charge cards, fees and payment details' })
  list(@Param('shareholderId') shareholderId: string, @CurrentUser() user: CurrentUserData) {
    return this.chargeCards.listForShareholder(shareholderId, user.id);
  }

  @Post()
  @ApiOperation({ summary: 'Request a charge card (shareholder must be ACTIVE)' })
  request(
    @Param('shareholderId') shareholderId: string,
    @CurrentUser() user: CurrentUserData,
    @Body() dto: RequestChargeCardDto,
  ) {
    return this.chargeCards.request(shareholderId, user.id, dto);
  }

  @Post(':cardId/cancel')
  @ApiOperation({ summary: 'Cancel a requested charge card' })
  cancel(
    @Param('shareholderId') shareholderId: string,
    @Param('cardId') cardId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.chargeCards.cancel(shareholderId, user.id, cardId);
  }

  @Post(':cardId/report-lost')
  @ApiOperation({ summary: 'Report a charge card lost (final)' })
  reportLost(
    @Param('shareholderId') shareholderId: string,
    @Param('cardId') cardId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.chargeCards.reportLost(shareholderId, user.id, cardId);
  }

  @Post(':cardId/request-reenable')
  @ApiOperation({ summary: 'Report that an active card stopped working (admin re-enables it at the provider)' })
  requestReenable(
    @Param('shareholderId') shareholderId: string,
    @Param('cardId') cardId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.chargeCards.requestReenable(shareholderId, user.id, cardId);
  }
}
