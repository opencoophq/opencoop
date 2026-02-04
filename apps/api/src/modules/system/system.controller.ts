import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CoopsService } from '../coops/coops.service';
import { CreateCoopDto } from '../coops/dto/create-coop.dto';
import { UpdateCoopDto } from '../coops/dto/update-coop.dto';
import { PrismaService } from '../../prisma/prisma.service';

@ApiTags('system')
@Controller('system')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SYSTEM_ADMIN')
@ApiBearerAuth()
export class SystemController {
  constructor(
    private coopsService: CoopsService,
    private prisma: PrismaService,
  ) {}

  // ==================== COOPS ====================

  @Get('coops')
  @ApiOperation({ summary: 'Get all coops' })
  async getCoops() {
    return this.coopsService.findAll();
  }

  @Post('coops')
  @ApiOperation({ summary: 'Create a new coop' })
  async createCoop(@Body() createCoopDto: CreateCoopDto) {
    return this.coopsService.create(createCoopDto);
  }

  @Put('coops/:id')
  @ApiOperation({ summary: 'Update a coop' })
  async updateCoop(
    @Param('id') id: string,
    @Body() updateCoopDto: UpdateCoopDto,
  ) {
    return this.coopsService.update(id, updateCoopDto);
  }

  @Get('coops/:id/admins')
  @ApiOperation({ summary: 'Get coop admins' })
  async getCoopAdmins(@Param('id') id: string) {
    return this.coopsService.getAdmins(id);
  }

  @Post('coops/:id/admins')
  @ApiOperation({ summary: 'Add a coop admin' })
  async addCoopAdmin(
    @Param('id') id: string,
    @Body('userId') userId: string,
  ) {
    // Only upgrade role if user is a regular shareholder (don't downgrade system admins)
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (user && user.role === 'SHAREHOLDER') {
      await this.prisma.user.update({
        where: { id: userId },
        data: { role: 'COOP_ADMIN' },
      });
    }

    return this.coopsService.addAdmin(id, userId);
  }

  @Delete('coops/:id/admins/:userId')
  @ApiOperation({ summary: 'Remove a coop admin' })
  async removeCoopAdmin(
    @Param('id') id: string,
    @Param('userId') userId: string,
  ) {
    return this.coopsService.removeAdmin(id, userId);
  }

  // ==================== STATS ====================

  @Get('stats')
  @ApiOperation({ summary: 'Get system statistics' })
  async getStats() {
    const [coopCount, userCount, shareholderCount, activeShareCount] = await Promise.all([
      this.prisma.coop.count(),
      this.prisma.user.count(),
      this.prisma.shareholder.count({ where: { status: 'ACTIVE' } }),
      this.prisma.share.count({ where: { status: 'ACTIVE' } }),
    ]);

    const totalShareValue = await this.prisma.share.aggregate({
      where: { status: 'ACTIVE' },
      _sum: {
        quantity: true,
      },
    });

    return {
      coopCount,
      userCount,
      shareholderCount,
      activeShareCount,
      totalShares: totalShareValue._sum.quantity || 0,
    };
  }

  // ==================== USERS ====================

  @Get('users')
  @ApiOperation({ summary: 'Get all users' })
  async getUsers() {
    return this.prisma.user.findMany({
      select: {
        id: true,
        email: true,
        role: true,
        preferredLanguage: true,
        emailVerified: true,
        createdAt: true,
        coopAdminOf: {
          include: {
            coop: {
              select: {
                id: true,
                name: true,
                slug: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Put('users/:id/role')
  @ApiOperation({ summary: 'Update user role' })
  async updateUserRole(
    @Param('id') id: string,
    @Body('role') role: 'SYSTEM_ADMIN' | 'COOP_ADMIN' | 'SHAREHOLDER',
  ) {
    return this.prisma.user.update({
      where: { id },
      data: { role },
      select: {
        id: true,
        email: true,
        role: true,
      },
    });
  }
}
