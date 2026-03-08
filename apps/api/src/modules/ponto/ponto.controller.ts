import {
  Controller,
  Get,
  Post,
  Query,
  Req,
  Res,
  Headers,
  Logger,
  BadRequestException,
  HttpCode,
  HttpStatus,
  RawBodyRequest,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { Public } from '../../common/decorators/public.decorator';
import { PontoService } from './ponto.service';
import { PontoWebhookPayload } from './dto/ponto-webhook.dto';

@ApiTags('ponto')
@Controller('ponto')
export class PontoController {
  private readonly logger = new Logger(PontoController.name);

  constructor(
    private readonly pontoService: PontoService,
    @InjectQueue('ponto') private readonly pontoQueue: Queue,
  ) {}

  // ==================== OAuth Callback ====================

  @Get('callback')
  @Public()
  @ApiOperation({ summary: 'OAuth2 callback from Ponto' })
  async handleCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    if (!code || !state) {
      throw new BadRequestException('Missing code or state parameter');
    }

    const coopId = await this.pontoService.handleCallbackByState(code, state);

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3002';
    res.redirect(`${frontendUrl}/dashboard/admin/settings?ponto=connected`);
  }

  // ==================== Webhook ====================

  @Post('webhooks')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Receive Ponto webhook events' })
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-signature') signature: string,
  ) {
    // Verify webhook signature
    const signingKey = process.env.PONTO_WEBHOOK_SIGNING_KEY;
    if (!signingKey) {
      this.logger.error('PONTO_WEBHOOK_SIGNING_KEY not configured');
      throw new BadRequestException('Webhook verification not configured');
    }

    const rawBody = req.rawBody;
    if (!rawBody) {
      throw new BadRequestException('Missing request body');
    }

    if (!signature) {
      throw new BadRequestException('Missing x-signature header');
    }

    // Compute expected HMAC-SHA256 signature
    const expectedSignature = createHmac('sha256', signingKey)
      .update(rawBody)
      .digest('hex');

    // Timing-safe comparison
    const sigBuffer = Buffer.from(signature, 'hex');
    const expectedBuffer = Buffer.from(expectedSignature, 'hex');

    if (
      sigBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(sigBuffer, expectedBuffer)
    ) {
      this.logger.warn('Ponto webhook signature verification failed');
      throw new BadRequestException('Invalid webhook signature');
    }

    // Parse the verified body
    const payload: PontoWebhookPayload = JSON.parse(rawBody.toString('utf-8'));
    const { attributes } = payload.data;

    this.logger.log(
      `Ponto webhook received: ${attributes.eventType} (id: ${payload.data.id})`,
    );

    // Process relevant events
    if (
      attributes.eventType === 'pontoConnect.account.transactionsCreated' &&
      attributes.synchronizationId &&
      attributes.accountId
    ) {
      await this.pontoQueue.add('process-transactions', {
        synchronizationId: attributes.synchronizationId,
        accountId: attributes.accountId,
      });

      this.logger.log(
        `Enqueued transaction processing for sync ${attributes.synchronizationId}, ` +
          `account ${attributes.accountId}`,
      );
    }

    return { received: true };
  }
}
