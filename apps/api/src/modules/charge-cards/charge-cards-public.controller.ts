import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { ChargeCardsService } from './charge-cards.service';

@ApiTags('charge-cards')
@Controller()
export class ChargeCardsPublicController {
  constructor(private readonly chargeCards: ChargeCardsService) {}

  @Public()
  @Get('public/coops/:slug/charge-cards')
  @ApiOperation({ summary: 'Public charge-card entry details for a cooperative' })
  info(@Param('slug') slug: string) {
    return this.chargeCards.publicInfo(slug);
  }
}
