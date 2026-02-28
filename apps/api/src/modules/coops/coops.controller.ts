import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { CoopsService } from './coops.service';
import { PublicRegisterDto } from './dto/public-register.dto';

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

  @Public()
  @Post(':slug/register')
  @ApiOperation({ summary: 'Public share registration (new or existing shareholder)' })
  @ApiResponse({ status: 201, description: 'Registration successful, returns transaction details' })
  @ApiResponse({ status: 404, description: 'Cooperative or shareholder not found' })
  @ApiResponse({ status: 400, description: 'Invalid registration data' })
  async register(
    @Param('slug') slug: string,
    @Body() dto: PublicRegisterDto,
  ) {
    return this.coopsService.publicRegister(slug, dto);
  }
}
