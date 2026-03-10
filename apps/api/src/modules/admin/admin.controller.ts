import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { Request, Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CoopGuard } from '../../common/guards/coop.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { CoopsService } from '../coops/coops.service';
import { AuditService } from '../audit/audit.service';
import { Prisma } from '@opencoop/database';
import { PrismaService } from '../../prisma/prisma.service';
import { AnalyticsService } from './analytics.service';
import { ReportsService } from './reports.service';
import { ShareholdersService } from '../shareholders/shareholders.service';
import { ShareholderImportService } from '../shareholders/shareholder-import.service';
import { ShareClassesService } from '../shares/share-classes.service';
import { ProjectsService } from '../projects/projects.service';
import { RegistrationsService } from '../registrations/registrations.service';
import { BankImportService } from '../bank-import/bank-import.service';
import { DividendsService } from '../dividends/dividends.service';
import { DocumentsService } from '../documents/documents.service';
import { CreateShareholderDto } from '../shareholders/dto/create-shareholder.dto';
import { UpdateShareholderDto } from '../shareholders/dto/update-shareholder.dto';
import { CreateBuyDto } from '../registrations/dto/create-buy.dto';
import { CreateSellDto } from '../registrations/dto/create-sell.dto';
import { CreateShareClassDto } from '../shares/dto/create-share-class.dto';
import { UpdateShareClassDto } from '../shares/dto/update-share-class.dto';
import { CreateProjectDto } from '../projects/dto/create-project.dto';
import { UpdateProjectDto } from '../projects/dto/update-project.dto';
import { CreateDividendPeriodDto } from '../dividends/dto/create-dividend-period.dto';
import { UpdateCoopDto } from '../coops/dto/update-coop.dto';
import { UpdateBrandingDto } from '../coops/dto/update-branding.dto';
import { maskShareholderPII, maskShareholderListPII } from '../../common/utils/mask-pii';
import { ChannelsService } from '../channels/channels.service';
import { CreateChannelDto } from '../channels/dto/create-channel.dto';
import { UpdateChannelDto } from '../channels/dto/update-channel.dto';
import { MessagesService } from '../messages/messages.service';
import { CreateConversationDto } from '../messages/dto/create-conversation.dto';
import { CreateMessageDto } from '../messages/dto/create-message.dto';

@ApiTags('admin')
@Controller('admin/coops/:coopId')
@UseGuards(JwtAuthGuard, RolesGuard, CoopGuard, SubscriptionGuard, PermissionGuard)
@Roles('SYSTEM_ADMIN', 'COOP_ADMIN')
@ApiBearerAuth()
export class AdminController {
  constructor(
    private coopsService: CoopsService,
    private auditService: AuditService,
    private prisma: PrismaService,
    private analyticsService: AnalyticsService,
    private reportsService: ReportsService,
    private shareholdersService: ShareholdersService,
    private shareholderImportService: ShareholderImportService,
    private shareClassesService: ShareClassesService,
    private projectsService: ProjectsService,
    private registrationsService: RegistrationsService,
    private bankImportService: BankImportService,
    private dividendsService: DividendsService,
    private documentsService: DocumentsService,
    private channelsService: ChannelsService,
    private messagesService: MessagesService,
  ) {}

  // ==================== COOP SETTINGS ====================

  @Get('settings')
  @RequirePermission('canManageSettings')
  @ApiOperation({ summary: 'Get coop settings (excludes secrets)' })
  async getSettings(@Param('coopId') coopId: string) {
    return this.coopsService.getSettings(coopId);
  }

  @Put('settings')
  @RequirePermission('canManageSettings')
  @ApiOperation({ summary: 'Update coop settings' })
  async updateSettings(
    @Param('coopId') coopId: string,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
    @Body() updateCoopDto: UpdateCoopDto,
  ) {
    // Only SYSTEM_ADMIN can toggle emailEnabled / pontoEnabled
    if (user.role !== 'SYSTEM_ADMIN') {
      delete updateCoopDto.emailEnabled;
      delete updateCoopDto.pontoEnabled;
    }
    return this.coopsService.update(coopId, updateCoopDto, user.id, req.ip, req.headers['user-agent']);
  }

  @Post('api-key/regenerate')
  @RequirePermission('canManageSettings')
  @ApiOperation({ summary: 'Generate or regenerate API key for external integrations' })
  async regenerateApiKey(
    @Param('coopId') coopId: string,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    return this.coopsService.regenerateApiKey(coopId, user.id, req.ip, req.headers['user-agent']);
  }

  @Put('branding')
  @RequirePermission('canManageSettings')
  @ApiOperation({ summary: 'Update coop branding' })
  async updateBranding(
    @Param('coopId') coopId: string,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
    @Body() updateBrandingDto: UpdateBrandingDto,
  ) {
    return this.coopsService.updateBranding(coopId, updateBrandingDto, user.id, req.ip, req.headers['user-agent']);
  }

  @Post('logo')
  @RequirePermission('canManageSettings')
  @ApiOperation({ summary: 'Upload coop logo' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  async uploadLogo(
    @Param('coopId') coopId: string,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.coopsService.uploadLogo(coopId, file, user.id, req.ip, req.headers['user-agent']);
  }

  @Delete('logo')
  @RequirePermission('canManageSettings')
  @ApiOperation({ summary: 'Remove coop logo' })
  async removeLogo(
    @Param('coopId') coopId: string,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    await this.coopsService.removeLogo(coopId, user.id, req.ip, req.headers['user-agent']);
    return { success: true };
  }

  // ==================== CHANNELS ====================

  @Get('channels')
  @RequirePermission('canManageSettings')
  @ApiOperation({ summary: 'List all channels' })
  async getChannels(@Param('coopId') coopId: string) {
    return this.channelsService.findAll(coopId);
  }

  @Get('channels/:channelId')
  @RequirePermission('canManageSettings')
  @ApiOperation({ summary: 'Get channel by ID' })
  async getChannel(
    @Param('coopId') coopId: string,
    @Param('channelId') channelId: string,
  ) {
    return this.channelsService.findById(channelId, coopId);
  }

  @Post('channels')
  @RequirePermission('canManageSettings')
  @ApiOperation({ summary: 'Create a channel' })
  async createChannel(
    @Param('coopId') coopId: string,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
    @Body() dto: CreateChannelDto,
  ) {
    return this.channelsService.create(coopId, dto, user.id, req.ip, req.headers['user-agent']);
  }

  @Put('channels/:channelId')
  @RequirePermission('canManageSettings')
  @ApiOperation({ summary: 'Update a channel' })
  async updateChannel(
    @Param('coopId') coopId: string,
    @Param('channelId') channelId: string,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
    @Body() dto: UpdateChannelDto,
  ) {
    return this.channelsService.update(channelId, coopId, dto, user.id, req.ip, req.headers['user-agent']);
  }

  @Delete('channels/:channelId')
  @RequirePermission('canManageSettings')
  @ApiOperation({ summary: 'Delete a channel (not the default)' })
  async deleteChannel(
    @Param('coopId') coopId: string,
    @Param('channelId') channelId: string,
  ) {
    return this.channelsService.delete(channelId, coopId);
  }

  @Post('channels/:channelId/logo')
  @RequirePermission('canManageSettings')
  @ApiOperation({ summary: 'Upload channel logo' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  async uploadChannelLogo(
    @Param('coopId') coopId: string,
    @Param('channelId') channelId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.channelsService.uploadLogo(channelId, coopId, file);
  }

  @Delete('channels/:channelId/logo')
  @RequirePermission('canManageSettings')
  @ApiOperation({ summary: 'Remove channel logo' })
  async removeChannelLogo(
    @Param('coopId') coopId: string,
    @Param('channelId') channelId: string,
  ) {
    await this.channelsService.removeLogo(channelId, coopId);
    return { success: true };
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get coop statistics' })
  async getStats(@Param('coopId') coopId: string) {
    const [
      totalShareholders,
      activeShareholders,
      pendingRegistrations,
      pendingShareholders,
      unmatchedBankTransactions,
    ] = await Promise.all([
      this.prisma.shareholder.count({ where: { coopId } }),
      this.prisma.shareholder.count({ where: { coopId, status: 'ACTIVE' } }),
      this.prisma.registration.count({ where: { coopId, status: 'PENDING' } }),
      this.prisma.shareholder.count({ where: { coopId, status: 'PENDING' } }),
      this.prisma.bankTransaction.count({ where: { coopId, matchStatus: 'UNMATCHED' } }),
    ]);

    // Use payments + registrations for capital — same source of truth as reports/charts
    const [capitalRow] = await this.prisma.$queryRaw<[{ total: string }]>(Prisma.sql`
      SELECT COALESCE(
        SUM(CASE WHEN r.type = 'BUY' THEN p.amount ELSE -p.amount END),
        0
      )::text AS total
      FROM payments p
      JOIN registrations r ON r.id = p."registrationId"
      WHERE r."coopId" = ${coopId}
        AND r.status IN ('ACTIVE', 'COMPLETED')
    `);
    const totalCapital = Number(capitalRow.total) || 0;

    return {
      totalShareholders,
      activeShareholders,
      totalCapital,
      pendingRegistrations,
      pendingShareholders,
      unmatchedBankTransactions,
    };
  }

  // ==================== SHAREHOLDERS ====================

  @Get('shareholders')
  @RequirePermission('canManageShareholders')
  @ApiOperation({ summary: 'Get all shareholders' })
  async getShareholders(
    @Param('coopId') coopId: string,
    @CurrentUser() user: CurrentUserData,
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('ecoPowerClient') ecoPowerClient?: string,
  ) {
    const result = await this.shareholdersService.findAll(coopId, { page, pageSize, search, status, type, ecoPowerClient });
    const canViewPII = user.role === 'SYSTEM_ADMIN' || user.coopPermissions?.[coopId]?.canViewPII !== false;
    return canViewPII ? result : maskShareholderListPII(result);
  }

  @Get('shareholders/import/template')
  @RequirePermission('canManageShareholders')
  @ApiOperation({ summary: 'Download CSV import template' })
  async getImportTemplate(@Res() res: Response) {
    const columns = this.shareholderImportService.getTemplateColumns();
    const csv = columns.join(',') + '\n';
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="shareholders-import-template.csv"');
    res.send(csv);
  }

  @Get('shareholders/:id')
  @RequirePermission('canManageShareholders')
  @ApiOperation({ summary: 'Get shareholder by ID' })
  async getShareholder(
    @Param('coopId') coopId: string,
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    const result = await this.shareholdersService.findById(id, coopId);
    const canViewPII = user.role === 'SYSTEM_ADMIN' || user.coopPermissions?.[coopId]?.canViewPII !== false;
    return canViewPII ? result : maskShareholderPII(result);
  }

  @Post('shareholders')
  @RequirePermission('canManageShareholders')
  @ApiOperation({ summary: 'Create a new shareholder' })
  async createShareholder(
    @Param('coopId') coopId: string,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
    @Body() createShareholderDto: CreateShareholderDto,
  ) {
    return this.shareholdersService.create(coopId, createShareholderDto, user.id, req.ip, req.headers['user-agent']);
  }

  @Post('shareholders/import')
  @RequirePermission('canManageShareholders')
  @ApiOperation({ summary: 'Import shareholders from CSV or Excel file' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const allowed = [
        'text/csv',
        'text/plain',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel',
      ];
      cb(null, allowed.includes(file.mimetype));
    },
  }))
  async importShareholders(
    @Param('coopId') coopId: string,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
    @Query('dryRun') dryRun?: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded. Accepted formats: .csv, .xlsx');
    }
    const isDryRun = dryRun?.toLowerCase() !== 'false';
    return this.shareholderImportService.importShareholders(
      coopId,
      file,
      isDryRun,
      user.id,
      req.ip,
      req.headers['user-agent'],
    );
  }

  @Put('shareholders/:id')
  @RequirePermission('canManageShareholders')
  @ApiOperation({ summary: 'Update a shareholder' })
  async updateShareholder(
    @Param('coopId') coopId: string,
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
    @Body() updateShareholderDto: UpdateShareholderDto,
  ) {
    return this.shareholdersService.update(id, coopId, updateShareholderDto, user.id, req.ip, req.headers['user-agent']);
  }

  // ==================== SHARE CLASSES ====================

  @Get('share-classes')
  @RequirePermission('canManageShareClasses')
  @ApiOperation({ summary: 'Get all share classes' })
  async getShareClasses(@Param('coopId') coopId: string) {
    return this.shareClassesService.findAll(coopId);
  }

  @Post('share-classes')
  @RequirePermission('canManageShareClasses')
  @ApiOperation({ summary: 'Create a new share class' })
  async createShareClass(
    @Param('coopId') coopId: string,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
    @Body() createShareClassDto: CreateShareClassDto,
  ) {
    return this.shareClassesService.create(coopId, createShareClassDto, user.id, req.ip, req.headers['user-agent']);
  }

  @Put('share-classes/:id')
  @RequirePermission('canManageShareClasses')
  @ApiOperation({ summary: 'Update a share class' })
  async updateShareClass(
    @Param('coopId') coopId: string,
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
    @Body() updateShareClassDto: UpdateShareClassDto,
  ) {
    return this.shareClassesService.update(id, coopId, updateShareClassDto, user.id, req.ip, req.headers['user-agent']);
  }

  // ==================== PROJECTS ====================

  @Get('projects')
  @RequirePermission('canManageProjects')
  @ApiOperation({ summary: 'Get all projects' })
  async getProjects(@Param('coopId') coopId: string) {
    return this.projectsService.findAll(coopId);
  }

  @Post('projects')
  @RequirePermission('canManageProjects')
  @ApiOperation({ summary: 'Create a new project' })
  async createProject(
    @Param('coopId') coopId: string,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
    @Body() createProjectDto: CreateProjectDto,
  ) {
    return this.projectsService.create(coopId, createProjectDto, user.id, req.ip, req.headers['user-agent']);
  }

  @Put('projects/:id')
  @RequirePermission('canManageProjects')
  @ApiOperation({ summary: 'Update a project' })
  async updateProject(
    @Param('coopId') coopId: string,
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
    @Body() updateProjectDto: UpdateProjectDto,
  ) {
    return this.projectsService.update(id, coopId, updateProjectDto, user.id, req.ip, req.headers['user-agent']);
  }

  @Delete('projects/:id')
  @RequirePermission('canManageProjects')
  @ApiOperation({ summary: 'Delete a project' })
  async deleteProject(
    @Param('coopId') coopId: string,
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    return this.projectsService.delete(id, coopId, user.id, req.ip, req.headers['user-agent']);
  }

  @Post('projects/import')
  @RequirePermission('canManageProjects')
  @ApiOperation({ summary: 'Import projects from CSV' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file'))
  async importProjects(
    @Param('coopId') coopId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const csvContent = file.buffer.toString('utf-8');
    return this.projectsService.importCsv(coopId, csvContent);
  }

  @Post('share-classes/import')
  @RequirePermission('canManageShareClasses')
  @ApiOperation({ summary: 'Import share classes from CSV' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file'))
  async importShareClasses(
    @Param('coopId') coopId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const csvContent = file.buffer.toString('utf-8');
    return this.shareClassesService.importCsv(coopId, csvContent);
  }

  // ==================== REGISTRATIONS ====================

  @Get('registrations')
  @RequirePermission('canManageTransactions')
  @ApiOperation({ summary: 'Get all registrations' })
  async getRegistrations(
    @Param('coopId') coopId: string,
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
    @Query('status') status?: 'PENDING' | 'PENDING_PAYMENT' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED',
    @Query('type') type?: string,
    @Query('shareholderId') shareholderId?: string,
  ) {
    return this.registrationsService.findAll(coopId, { page, pageSize, status, type, shareholderId });
  }

  @Put('registrations/:id/approve')
  @RequirePermission('canManageTransactions')
  @ApiOperation({ summary: 'Approve a registration' })
  async approveRegistration(
    @Param('coopId') coopId: string,
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.registrationsService.approve(id, coopId, user.id);
  }

  @Put('registrations/:id/reject')
  @RequirePermission('canManageTransactions')
  @ApiOperation({ summary: 'Reject a registration' })
  async rejectRegistration(
    @Param('coopId') coopId: string,
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserData,
    @Body('reason') reason: string,
  ) {
    return this.registrationsService.reject(id, coopId, user.id, reason);
  }

  @Post('transfers')
  @RequirePermission('canManageTransactions')
  @ApiOperation({ summary: 'Create an admin-initiated transfer' })
  async createTransfer(
    @Param('coopId') coopId: string,
    @CurrentUser() user: CurrentUserData,
    @Body() transferDto: {
      fromShareholderId: string;
      toShareholderId: string;
      registrationId: string;
      quantity: number;
    },
  ) {
    return this.registrationsService.createTransfer({
      coopId,
      ...transferDto,
      processedByUserId: user.id,
    });
  }

  @Post('shareholders/:shareholderId/buy')
  @RequirePermission('canManageTransactions')
  @ApiOperation({ summary: 'Create a buy registration on behalf of a shareholder' })
  async createBuy(
    @Param('coopId') coopId: string,
    @Param('shareholderId') shareholderId: string,
    @Body() createBuyDto: CreateBuyDto,
  ) {
    return this.registrationsService.createBuy({
      coopId,
      shareholderId,
      ...createBuyDto,
    });
  }

  @Post('shareholders/:shareholderId/sell')
  @RequirePermission('canManageTransactions')
  @ApiOperation({ summary: 'Create a sell registration on behalf of a shareholder' })
  async createSell(
    @Param('coopId') coopId: string,
    @Param('shareholderId') shareholderId: string,
    @Body() createSellDto: CreateSellDto,
  ) {
    return this.registrationsService.createSell({
      coopId,
      shareholderId,
      ...createSellDto,
    });
  }

  @Get('registrations/:id/payment-details')
  @RequirePermission('canManageTransactions')
  @ApiOperation({ summary: 'Get payment details for a registration (IBAN, amount, OGM for QR code)' })
  async getPaymentDetails(
    @Param('coopId') coopId: string,
    @Param('id') id: string,
  ) {
    return this.registrationsService.getPaymentDetails(id, coopId);
  }

  @Put('registrations/:id/complete')
  @RequirePermission('canManageTransactions')
  @ApiOperation({ summary: 'Mark a registration as completed' })
  async completeRegistration(
    @Param('coopId') coopId: string,
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.registrationsService.complete(id, user.id, undefined, coopId);
  }

  // ==================== BANK IMPORT ====================

  @Get('bank-imports')
  @RequirePermission('canManageTransactions')
  @ApiOperation({ summary: 'Get all bank imports' })
  async getBankImports(@Param('coopId') coopId: string) {
    return this.bankImportService.getImports(coopId);
  }

  @Post('bank-import')
  @RequirePermission('canManageTransactions')
  @ApiOperation({ summary: 'Import bank transactions from CSV' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file'))
  async importBankTransactions(
    @Param('coopId') coopId: string,
    @CurrentUser() user: CurrentUserData,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const csvContent = file.buffer.toString('utf-8');
    return this.bankImportService.importBelfiusCsv(
      coopId,
      user.id,
      file.originalname,
      csvContent,
    );
  }

  @Get('bank-transactions')
  @RequirePermission('canManageTransactions')
  @ApiOperation({ summary: 'Get bank transactions' })
  async getBankTransactions(
    @Param('coopId') coopId: string,
    @Query('bankImportId') bankImportId?: string,
    @Query('matchStatus') matchStatus?: string,
  ) {
    return this.bankImportService.getTransactions(coopId, bankImportId, matchStatus);
  }

  @Get('bank-transactions/unmatched')
  @RequirePermission('canManageTransactions')
  @ApiOperation({ summary: 'Get unmatched Ponto bank transactions' })
  async getUnmatchedBankTransactions(@Param('coopId') coopId: string) {
    return this.prisma.bankTransaction.findMany({
      where: {
        coopId,
        matchStatus: 'UNMATCHED',
        pontoTransactionId: { not: null },
        amount: { gt: 0 },
      },
      orderBy: { date: 'desc' },
    });
  }

  @Post('bank-transactions/:id/match')
  @RequirePermission('canManageTransactions')
  @ApiOperation({ summary: 'Manually match a bank transaction to a registration' })
  async matchBankTransaction(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserData,
    @Body('registrationId') registrationId: string,
  ) {
    return this.bankImportService.manualMatch(id, registrationId, user.id);
  }

  // ==================== DIVIDENDS ====================

  @Get('dividends')
  @RequirePermission('canManageDividends')
  @ApiOperation({ summary: 'Get all dividend periods' })
  async getDividendPeriods(@Param('coopId') coopId: string) {
    return this.dividendsService.findAll(coopId);
  }

  @Get('dividends/:id')
  @RequirePermission('canManageDividends')
  @ApiOperation({ summary: 'Get dividend period details' })
  async getDividendPeriod(@Param('id') id: string) {
    return this.dividendsService.findById(id);
  }

  @Post('dividends')
  @RequirePermission('canManageDividends')
  @ApiOperation({ summary: 'Create a new dividend period' })
  async createDividendPeriod(
    @Param('coopId') coopId: string,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
    @Body() createDividendPeriodDto: CreateDividendPeriodDto,
  ) {
    return this.dividendsService.create(coopId, createDividendPeriodDto, user.id, req.ip, req.headers['user-agent']);
  }

  @Post('dividends/:id/calculate')
  @RequirePermission('canManageDividends')
  @ApiOperation({ summary: 'Calculate dividends for a period' })
  async calculateDividends(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    return this.dividendsService.calculate(id, user.id, req.ip, req.headers['user-agent']);
  }

  @Post('dividends/:id/mark-paid')
  @RequirePermission('canManageDividends')
  @ApiOperation({ summary: 'Mark dividend period as paid' })
  async markDividendsPaid(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
    @Body('paymentReference') paymentReference?: string,
  ) {
    return this.dividendsService.markAsPaid(id, paymentReference, user.id, req.ip, req.headers['user-agent']);
  }

  @Get('dividends/:id/export')
  @RequirePermission('canManageDividends')
  @ApiOperation({ summary: 'Export dividend payouts as CSV for bank transfer' })
  async exportDividends(
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const csv = await this.dividendsService.exportToCsv(id);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="dividend-payouts-${id}.csv"`);
    res.send(csv);
  }

  // ==================== ANALYTICS ====================

  @Get('analytics/capital-timeline')
  @ApiOperation({ summary: 'Get capital timeline data' })
  async getCapitalTimeline(
    @Param('coopId') coopId: string,
    @Query('period') period?: string,
  ) {
    const validPeriod = ['day', 'month', 'quarter', 'year', 'all'].includes(period || '')
      ? (period as 'day' | 'month' | 'quarter' | 'year' | 'all')
      : 'month';
    return this.analyticsService.getCapitalTimeline(coopId, validPeriod);
  }

  @Get('analytics/capital-by-project')
  @ApiOperation({ summary: 'Get capital breakdown by project' })
  async getCapitalByProject(@Param('coopId') coopId: string) {
    return this.analyticsService.getCapitalByProject(coopId);
  }

  @Get('analytics/shareholder-growth')
  @ApiOperation({ summary: 'Get shareholder growth data' })
  async getShareholderGrowth(
    @Param('coopId') coopId: string,
    @Query('period') period?: string,
  ) {
    const validPeriod = ['day', 'month', 'quarter', 'year', 'all'].includes(period || '')
      ? (period as 'day' | 'month' | 'quarter' | 'year' | 'all')
      : 'month';
    return this.analyticsService.getShareholderGrowth(coopId, validPeriod);
  }

  @Get('analytics/transaction-summary')
  @ApiOperation({ summary: 'Get transaction summary data' })
  async getTransactionSummary(
    @Param('coopId') coopId: string,
    @Query('period') period?: string,
  ) {
    const validPeriod = ['day', 'month', 'quarter', 'year', 'all'].includes(period || '')
      ? (period as 'day' | 'month' | 'quarter' | 'year' | 'all')
      : 'month';
    return this.analyticsService.getTransactionSummary(coopId, validPeriod);
  }

  // ==================== REPORTS ====================

  @Get('reports/annual-overview')
  @RequirePermission('canViewReports')
  @ApiOperation({ summary: 'Get annual overview report data' })
  async getAnnualOverview(
    @Param('coopId') coopId: string,
    @Query('year') year?: string,
  ) {
    const y = parseInt(year || '', 10) || new Date().getFullYear();
    return this.reportsService.getAnnualOverview(coopId, y);
  }

  @Get('reports/capital-statement')
  @RequirePermission('canViewReports')
  @ApiOperation({ summary: 'Get capital statement report data' })
  async getCapitalStatement(
    @Param('coopId') coopId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const now = new Date();
    const fromDate = from || `${now.getFullYear()}-01-01`;
    const toDate = to || now.toISOString().split('T')[0];
    return this.reportsService.getCapitalStatement(coopId, fromDate, toDate);
  }

  @Get('reports/shareholder-register')
  @RequirePermission('canViewShareholderRegister')
  @ApiOperation({ summary: 'Get shareholder register report data' })
  async getShareholderRegister(
    @Param('coopId') coopId: string,
    @Query('date') date?: string,
  ) {
    return this.reportsService.getShareholderRegister(coopId, date);
  }

  @Get('reports/dividend-summary')
  @RequirePermission('canViewReports')
  @ApiOperation({ summary: 'Get dividend summary report data' })
  async getDividendSummary(
    @Param('coopId') coopId: string,
    @Query('year') year?: string,
  ) {
    const y = parseInt(year || '', 10) || new Date().getFullYear();
    return this.reportsService.getDividendSummary(coopId, y);
  }

  @Get('reports/project-investment')
  @RequirePermission('canViewReports')
  @ApiOperation({ summary: 'Get project investment report data' })
  async getProjectInvestment(
    @Param('coopId') coopId: string,
    @Query('projectId') projectId?: string,
  ) {
    return this.reportsService.getProjectInvestment(coopId, projectId);
  }

  @Get('reports/:type/csv')
  @RequirePermission('canViewReports')
  @ApiOperation({ summary: 'Export report as CSV' })
  async exportReportCsv(
    @Param('coopId') coopId: string,
    @Param('type') type: string,
    @Query() params: Record<string, string>,
    @Res() res: Response,
  ) {
    const { csv } = await this.reportsService.exportReport(coopId, type, params);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${type}-${Date.now()}.csv"`);
    res.send(csv);
  }

  @Get('reports/:type/pdf')
  @RequirePermission('canViewReports')
  @ApiOperation({ summary: 'Export report as PDF' })
  async exportReportPdf(
    @Param('coopId') coopId: string,
    @Param('type') type: string,
    @Query() params: Record<string, string>,
    @Res() res: Response,
  ) {
    const buffer = await this.reportsService.generatePdf(coopId, type, params);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${type}-${Date.now()}.pdf"`);
    res.send(buffer);
  }

  // ==================== DOCUMENTS ====================

  @Post('shareholders/:shareholderId/certificate')
  @RequirePermission('canManageShareholders')
  @ApiOperation({ summary: 'Generate share certificate for a shareholder' })
  async generateCertificate(
    @Param('shareholderId') shareholderId: string,
    @Query('locale') locale?: string,
  ) {
    return this.documentsService.generateCertificate(shareholderId, locale);
  }

  @Post('registrations/:registrationId/resend-payment-email')
  @RequirePermission('canManageShareholders')
  @ApiOperation({ summary: 'Resend payment info email for a registration' })
  async resendPaymentEmail(
    @Param('coopId') coopId: string,
    @Param('registrationId') registrationId: string,
  ) {
    return this.registrationsService.resendPaymentEmail(registrationId, coopId);
  }

  @Post('registrations/:registrationId/certificate')
  @RequirePermission('canManageShareholders')
  @ApiOperation({ summary: 'Generate share certificate for a specific registration' })
  async generateCertificateForRegistration(
    @Param('coopId') coopId: string,
    @Param('registrationId') registrationId: string,
    @Query('locale') locale?: string,
  ) {
    return this.documentsService.generateCertificateForRegistration(registrationId, coopId, locale);
  }

  @Post('shareholders/:shareholderId/dividend-statement/:dividendPayoutId')
  @RequirePermission('canManageShareholders')
  @ApiOperation({ summary: 'Generate dividend statement for a shareholder' })
  async generateDividendStatement(
    @Param('shareholderId') shareholderId: string,
    @Param('dividendPayoutId') dividendPayoutId: string,
    @Query('locale') locale?: string,
  ) {
    return this.documentsService.generateDividendStatement(shareholderId, dividendPayoutId, locale);
  }

  @Get('documents/:documentId/download')
  @RequirePermission('canManageShareholders')
  @ApiOperation({ summary: 'Download a document by ID (admin)' })
  async downloadDocument(
    @Param('coopId') coopId: string,
    @Param('documentId') documentId: string,
    @Res() res: Response,
  ) {
    const doc = await this.prisma.shareholderDocument.findFirst({
      where: { id: documentId },
      include: { shareholder: { select: { coopId: true } } },
    });

    if (!doc || doc.shareholder.coopId !== coopId) {
      throw new NotFoundException('Document not found');
    }

    if (!fs.existsSync(doc.filePath)) {
      throw new NotFoundException('Document file not found');
    }

    const fileName = path.basename(doc.filePath);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    fs.createReadStream(doc.filePath).pipe(res);
  }

  // ==================== AUDIT LOGS ====================

  @Get('audit-logs')
  @ApiOperation({ summary: 'Get audit logs for this coop' })
  async getAuditLogs(
    @Param('coopId') coopId: string,
    @Query('entity') entity?: string,
    @Query('entityId') entityId?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.auditService.findByCoop(coopId, {
      entity,
      entityId,
      page: Number(page) || 1,
      limit: Number(limit) || 50,
    });
  }

  // ==================== MESSAGES ====================

  @Get('conversations')
  @RequirePermission('canManageMessages')
  @ApiOperation({ summary: 'List all conversations for this coop' })
  async listConversations(
    @Param('coopId') coopId: string,
    @Query('page') page?: number,
  ) {
    return this.messagesService.findAllForCoop(coopId, Number(page) || 1);
  }

  @Post('conversations')
  @RequirePermission('canManageMessages')
  @ApiOperation({ summary: 'Create a new conversation (broadcast or direct)' })
  async createConversation(
    @Param('coopId') coopId: string,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
    @Body() dto: CreateConversationDto,
  ) {
    return this.messagesService.createConversation(
      coopId, dto, user.id, req.ip, req.headers['user-agent'] as string,
    );
  }

  @Get('conversations/:conversationId')
  @RequirePermission('canManageMessages')
  @ApiOperation({ summary: 'Get conversation detail with messages' })
  async getConversation(
    @Param('coopId') coopId: string,
    @Param('conversationId') conversationId: string,
  ) {
    return this.messagesService.findByIdForAdmin(conversationId, coopId);
  }

  @Post('conversations/:conversationId/messages')
  @RequirePermission('canManageMessages')
  @ApiOperation({ summary: 'Reply to a conversation' })
  async replyToConversation(
    @Param('coopId') coopId: string,
    @Param('conversationId') conversationId: string,
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreateMessageDto,
  ) {
    return this.messagesService.addAdminReply(conversationId, coopId, dto, user.id);
  }

  @Post('conversations/:conversationId/messages/:messageId/attachments')
  @RequirePermission('canManageMessages')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload attachment to a message' })
  async uploadMessageAttachment(
    @Param('coopId') coopId: string,
    @Param('conversationId') conversationId: string,
    @Param('messageId') messageId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.messagesService.addUploadedAttachment(conversationId, coopId, messageId, file);
  }
}
