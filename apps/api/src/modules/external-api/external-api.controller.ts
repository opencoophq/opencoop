import { Controller, Post, Patch, Body, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiKeyGuard } from '../../common/guards/api-key.guard';
import { ApiKeyThrottleGuard } from './api-key-throttle.guard';
import { ExternalApiService } from './external-api.service';
import { QueryShareholdersDto } from './dto/query-shareholders.dto';
import { UpdateEcoPowerDto } from './dto/update-ecopower.dto';

@ApiTags('external')
@Controller('external')
@UseGuards(ApiKeyGuard, ApiKeyThrottleGuard)
@ApiBearerAuth()
@SkipThrottle()
export class ExternalApiController {
  constructor(private externalApiService: ExternalApiService) {}

  @Post('shareholders/query')
  @ApiOperation({ summary: 'Batch query shareholders by email' })
  async queryShareholders(@Req() req: any, @Body() dto: QueryShareholdersDto) {
    const coopId = req.coop.id;
    const results = await this.externalApiService.queryShareholders(
      coopId,
      dto.shareholders.map((s) => s.email),
    );
    return { results };
  }

  @Patch('shareholders/ecopower')
  @ApiOperation({ summary: 'Batch update Ecopower client status' })
  async updateEcoPower(@Req() req: any, @Body() dto: UpdateEcoPowerDto) {
    const coopId = req.coop.id;
    const results = await this.externalApiService.updateEcoPowerStatus(coopId, dto.updates);
    return { results };
  }
}
