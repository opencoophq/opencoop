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
  @Get(':slug/public-projects')
  @ApiOperation({ summary: 'Get public project data with live investment stats' })
  @ApiResponse({ status: 200, description: 'Projects with aggregated share stats' })
  @ApiResponse({ status: 404, description: 'Cooperative not found' })
  async getPublicProjects(@Param('slug') slug: string) {
    return this.coopsService.getPublicProjects(slug);
  }

  @Public()
  @Get(':slug/public-stats')
  @ApiOperation({ summary: 'Get aggregate coop statistics (all shares, not just per-project)' })
  @ApiResponse({ status: 200, description: 'Aggregate stats: shareholders, capital, shares' })
  @ApiResponse({ status: 404, description: 'Cooperative not found' })
  async getPublicStats(@Param('slug') slug: string) {
    return this.coopsService.getPublicStats(slug);
  }

  @Public()
  @Get(':slug/referrer/:code')
  @ApiOperation({ summary: 'Look up referrer display name by referral code (public)' })
  @ApiResponse({ status: 200, description: 'Referrer first name and last initial' })
  @ApiResponse({ status: 404, description: 'Referral code not found' })
  async getReferrer(
    @Param('slug') slug: string,
    @Param('code') code: string,
  ) {
    return this.coopsService.lookupReferrer(slug, code);
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
