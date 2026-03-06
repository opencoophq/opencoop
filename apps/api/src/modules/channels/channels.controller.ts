import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { ChannelsService } from './channels.service';
import { PublicRegisterDto } from '../coops/dto/public-register.dto';

@ApiTags('channels')
@Controller('coops/:slug/channels')
export class ChannelsController {
  constructor(private readonly channelsService: ChannelsService) {}

  @Public()
  @Get(':channelSlug/public-info')
  @ApiOperation({ summary: 'Get public channel information' })
  @ApiResponse({ status: 200, description: 'Channel branding with filtered share classes and projects' })
  @ApiResponse({ status: 404, description: 'Channel or cooperative not found' })
  async getPublicInfo(
    @Param('slug') slug: string,
    @Param('channelSlug') channelSlug: string,
  ) {
    return this.channelsService.getPublicInfo(slug, channelSlug);
  }

  @Public()
  @Post(':channelSlug/register')
  @ApiOperation({ summary: 'Public share registration via channel' })
  @ApiResponse({ status: 201, description: 'Registration successful' })
  @ApiResponse({ status: 404, description: 'Channel or cooperative not found' })
  async register(
    @Param('slug') slug: string,
    @Param('channelSlug') channelSlug: string,
    @Body() dto: PublicRegisterDto,
  ) {
    return this.channelsService.publicRegister(slug, channelSlug, dto);
  }
}
