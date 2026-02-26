import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CoopGuard } from '../../common/guards/coop.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { SkipSubscriptionCheck } from '../../common/decorators/skip-subscription-check.decorator';
import { BillingService } from './billing.service';
import { CreateCheckoutDto } from './dto/create-checkout.dto';

@ApiTags('billing')
@Controller('admin/coops/:coopId/billing')
@UseGuards(JwtAuthGuard, RolesGuard, CoopGuard)
@Roles('SYSTEM_ADMIN', 'COOP_ADMIN')
@SkipSubscriptionCheck()
@ApiBearerAuth()
export class BillingController {
  constructor(private billingService: BillingService) {}

  @Get()
  @ApiOperation({ summary: 'Get billing info for a coop' })
  async getBillingInfo(@Param('coopId') coopId: string) {
    return this.billingService.getBillingInfo(coopId);
  }

  @Post('checkout')
  @ApiOperation({ summary: 'Create a Stripe checkout session' })
  async createCheckoutSession(
    @Param('coopId') coopId: string,
    @Body() dto: CreateCheckoutDto,
  ) {
    return this.billingService.createCheckoutSession(coopId, dto.plan, dto.billingPeriod);
  }

  @Post('portal')
  @ApiOperation({ summary: 'Create a Stripe customer portal session' })
  async createPortalSession(@Param('coopId') coopId: string) {
    return this.billingService.createPortalSession(coopId);
  }
}
