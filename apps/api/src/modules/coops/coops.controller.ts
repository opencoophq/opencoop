import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { CoopsService } from './coops.service';

@ApiTags('coops')
@Controller('coops')
export class CoopsController {
  constructor(private readonly coopsService: CoopsService) {}

  @Public()
  @Get(':slug/public-info')
  @ApiOperation({ summary: 'Get public coop information by slug' })
  @ApiResponse({ status: 200, description: 'Public coop info with share classes and projects' })
  @ApiResponse({ status: 404, description: 'Cooperative not found' })
  async getPublicInfo(@Param('slug') slug: string) {
    return this.coopsService.getPublicInfo(slug);
  }
}
