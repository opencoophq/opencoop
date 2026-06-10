import { Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { CreateFeatureRequestDto } from './dto/create-feature-request.dto';
import { FeatureRequestsService } from './feature-requests.service';

@ApiTags('Feature Requests')
@Controller('feature-requests')
export class FeatureRequestsController {
  constructor(private readonly featureRequestsService: FeatureRequestsService) {}

  @Public()
  @Post()
  @Throttle({ default: { ttl: 60000, limit: 3 } })
  @ApiOperation({ summary: 'Submit a feature request' })
  create(@Body() dto: CreateFeatureRequestDto) {
    return this.featureRequestsService.create(dto);
  }
}
