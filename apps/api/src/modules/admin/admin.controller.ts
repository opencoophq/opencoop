import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Res,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CoopGuard } from '../../common/guards/coop.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { CoopsService } from '../coops/coops.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ShareholdersService } from '../shareholders/shareholders.service';
import { ShareClassesService } from '../shares/share-classes.service';
import { ProjectsService } from '../projects/projects.service';
import { TransactionsService } from '../transactions/transactions.service';
import { BankImportService } from '../bank-import/bank-import.service';
import { DividendsService } from '../dividends/dividends.service';
import { DocumentsService } from '../documents/documents.service';
import { CreateShareholderDto } from '../shareholders/dto/create-shareholder.dto';
import { UpdateShareholderDto } from '../shareholders/dto/update-shareholder.dto';
import { CreateShareClassDto } from '../shares/dto/create-share-class.dto';
import { UpdateShareClassDto } from '../shares/dto/update-share-class.dto';
import { CreateProjectDto } from '../projects/dto/create-project.dto';
import { UpdateProjectDto } from '../projects/dto/update-project.dto';
import { CreateDividendPeriodDto } from '../dividends/dto/create-dividend-period.dto';
import { UpdateCoopDto } from '../coops/dto/update-coop.dto';
import { UpdateBrandingDto } from '../coops/dto/update-branding.dto';

@ApiTags('admin')
@Controller('admin/coops/:coopId')
@UseGuards(JwtAuthGuard, RolesGuard, CoopGuard)
@Roles('SYSTEM_ADMIN', 'COOP_ADMIN')
@ApiBearerAuth()
export class AdminController {
  constructor(
    private coopsService: CoopsService,
    private prisma: PrismaService,
    private shareholdersService: ShareholdersService,
    private shareClassesService: ShareClassesService,
    private projectsService: ProjectsService,
    private transactionsService: TransactionsService,
    private bankImportService: BankImportService,
    private dividendsService: DividendsService,
    private documentsService: DocumentsService,
  ) {}

  // ==================== COOP SETTINGS ====================

  @Get('settings')
  @ApiOperation({ summary: 'Get coop settings (excludes secrets)' })
  async getSettings(@Param('coopId') coopId: string) {
    return this.coopsService.getSettings(coopId);
  }

  @Put('settings')
  @ApiOperation({ summary: 'Update coop settings' })
  async updateSettings(
    @Param('coopId') coopId: string,
    @CurrentUser() user: CurrentUserData,
    @Body() updateCoopDto: UpdateCoopDto,
  ) {
    // Only SYSTEM_ADMIN can toggle emailEnabled
    if (user.role !== 'SYSTEM_ADMIN') {
      delete updateCoopDto.emailEnabled;
    }
    return this.coopsService.update(coopId, updateCoopDto);
  }

  @Put('branding')
  @ApiOperation({ summary: 'Update coop branding' })
  async updateBranding(
    @Param('coopId') coopId: string,
    @Body() updateBrandingDto: UpdateBrandingDto,
  ) {
    return this.coopsService.updateBranding(coopId, updateBrandingDto);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get coop statistics' })
  async getStats(@Param('coopId') coopId: string) {
    const [
      totalShareholders,
      activeShareholders,
      totalShares,
      pendingTransactions,
      pendingPayments,
      pendingShareholders,
      unmatchedBankTransactions,
    ] = await Promise.all([
      this.prisma.shareholder.count({ where: { coopId } }),
      this.prisma.shareholder.count({ where: { coopId, status: 'ACTIVE' } }),
      this.prisma.share.count({ where: { coopId, status: 'ACTIVE' } }),
      this.prisma.transaction.count({ where: { coopId, status: 'PENDING' } }),
      this.prisma.payment.count({ where: { coopId, status: 'PENDING' } }),
      this.prisma.shareholder.count({ where: { coopId, status: 'PENDING' } }),
      this.prisma.bankTransaction.count({ where: { coopId, matchStatus: 'UNMATCHED' } }),
    ]);

    const capitalResult = await this.prisma.share.aggregate({
      where: { coopId, status: 'ACTIVE' },
      _sum: { quantity: true },
    });

    // Get average share price to calculate total capital
    const shareClasses = await this.prisma.shareClass.findMany({
      where: { coopId },
      select: { id: true, pricePerShare: true },
    });

    const shares = await this.prisma.share.findMany({
      where: { coopId, status: 'ACTIVE' },
      select: { quantity: true, shareClassId: true },
    });

    const totalCapital = shares.reduce((sum, share) => {
      const shareClass = shareClasses.find((sc) => sc.id === share.shareClassId);
      const price = shareClass?.pricePerShare?.toNumber() || 0;
      return sum + share.quantity * price;
    }, 0);

    return {
      totalShareholders,
      activeShareholders,
      totalShares: capitalResult._sum.quantity || 0,
      totalCapital,
      pendingTransactions,
      pendingPayments,
      pendingShareholders,
      unmatchedBankTransactions,
    };
  }

  // ==================== SHAREHOLDERS ====================

  @Get('shareholders')
  @ApiOperation({ summary: 'Get all shareholders' })
  async getShareholders(
    @Param('coopId') coopId: string,
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('type') type?: string,
  ) {
    return this.shareholdersService.findAll(coopId, { page, pageSize, search, status, type });
  }

  @Get('shareholders/:id')
  @ApiOperation({ summary: 'Get shareholder by ID' })
  async getShareholder(
    @Param('coopId') coopId: string,
    @Param('id') id: string,
  ) {
    return this.shareholdersService.findById(id, coopId);
  }

  @Post('shareholders')
  @ApiOperation({ summary: 'Create a new shareholder' })
  async createShareholder(
    @Param('coopId') coopId: string,
    @Body() createShareholderDto: CreateShareholderDto,
  ) {
    return this.shareholdersService.create(coopId, createShareholderDto);
  }

  @Put('shareholders/:id')
  @ApiOperation({ summary: 'Update a shareholder' })
  async updateShareholder(
    @Param('coopId') coopId: string,
    @Param('id') id: string,
    @Body() updateShareholderDto: UpdateShareholderDto,
  ) {
    return this.shareholdersService.update(id, coopId, updateShareholderDto);
  }

  // ==================== SHARE CLASSES ====================

  @Get('share-classes')
  @ApiOperation({ summary: 'Get all share classes' })
  async getShareClasses(@Param('coopId') coopId: string) {
    return this.shareClassesService.findAll(coopId);
  }

  @Post('share-classes')
  @ApiOperation({ summary: 'Create a new share class' })
  async createShareClass(
    @Param('coopId') coopId: string,
    @Body() createShareClassDto: CreateShareClassDto,
  ) {
    return this.shareClassesService.create(coopId, createShareClassDto);
  }

  @Put('share-classes/:id')
  @ApiOperation({ summary: 'Update a share class' })
  async updateShareClass(
    @Param('coopId') coopId: string,
    @Param('id') id: string,
    @Body() updateShareClassDto: UpdateShareClassDto,
  ) {
    return this.shareClassesService.update(id, coopId, updateShareClassDto);
  }

  // ==================== PROJECTS ====================

  @Get('projects')
  @ApiOperation({ summary: 'Get all projects' })
  async getProjects(@Param('coopId') coopId: string) {
    return this.projectsService.findAll(coopId);
  }

  @Post('projects')
  @ApiOperation({ summary: 'Create a new project' })
  async createProject(
    @Param('coopId') coopId: string,
    @Body() createProjectDto: CreateProjectDto,
  ) {
    return this.projectsService.create(coopId, createProjectDto);
  }

  @Put('projects/:id')
  @ApiOperation({ summary: 'Update a project' })
  async updateProject(
    @Param('coopId') coopId: string,
    @Param('id') id: string,
    @Body() updateProjectDto: UpdateProjectDto,
  ) {
    return this.projectsService.update(id, coopId, updateProjectDto);
  }

  @Delete('projects/:id')
  @ApiOperation({ summary: 'Delete a project' })
  async deleteProject(
    @Param('coopId') coopId: string,
    @Param('id') id: string,
  ) {
    return this.projectsService.delete(id, coopId);
  }

  // ==================== TRANSACTIONS ====================

  @Get('transactions')
  @ApiOperation({ summary: 'Get all transactions' })
  async getTransactions(
    @Param('coopId') coopId: string,
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
    @Query('status') status?: 'PENDING' | 'APPROVED' | 'COMPLETED' | 'REJECTED',
    @Query('type') type?: string,
    @Query('shareholderId') shareholderId?: string,
  ) {
    return this.transactionsService.findAll(coopId, { page, pageSize, status, type, shareholderId });
  }

  @Put('transactions/:id/approve')
  @ApiOperation({ summary: 'Approve a transaction' })
  async approveTransaction(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.transactionsService.approve(id, user.id);
  }

  @Put('transactions/:id/reject')
  @ApiOperation({ summary: 'Reject a transaction' })
  async rejectTransaction(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserData,
    @Body('reason') reason: string,
  ) {
    return this.transactionsService.reject(id, user.id, reason);
  }

  @Post('transfers')
  @ApiOperation({ summary: 'Create an admin-initiated transfer' })
  async createTransfer(
    @Param('coopId') coopId: string,
    @CurrentUser() user: CurrentUserData,
    @Body() transferDto: {
      fromShareholderId: string;
      toShareholderId: string;
      shareId: string;
      quantity: number;
    },
  ) {
    return this.transactionsService.createTransfer({
      coopId,
      ...transferDto,
      processedByUserId: user.id,
    });
  }

  // ==================== BANK IMPORT ====================

  @Get('bank-imports')
  @ApiOperation({ summary: 'Get all bank imports' })
  async getBankImports(@Param('coopId') coopId: string) {
    return this.bankImportService.getImports(coopId);
  }

  @Post('bank-import')
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
  @ApiOperation({ summary: 'Get bank transactions' })
  async getBankTransactions(
    @Param('coopId') coopId: string,
    @Query('bankImportId') bankImportId?: string,
    @Query('matchStatus') matchStatus?: string,
  ) {
    return this.bankImportService.getTransactions(coopId, bankImportId, matchStatus);
  }

  @Post('bank-transactions/:id/match')
  @ApiOperation({ summary: 'Manually match a bank transaction to a payment' })
  async matchBankTransaction(
    @Param('id') id: string,
    @Body('paymentId') paymentId: string,
  ) {
    return this.bankImportService.manualMatch(id, paymentId);
  }

  // ==================== DIVIDENDS ====================

  @Get('dividends')
  @ApiOperation({ summary: 'Get all dividend periods' })
  async getDividendPeriods(@Param('coopId') coopId: string) {
    return this.dividendsService.findAll(coopId);
  }

  @Get('dividends/:id')
  @ApiOperation({ summary: 'Get dividend period details' })
  async getDividendPeriod(@Param('id') id: string) {
    return this.dividendsService.findById(id);
  }

  @Post('dividends')
  @ApiOperation({ summary: 'Create a new dividend period' })
  async createDividendPeriod(
    @Param('coopId') coopId: string,
    @Body() createDividendPeriodDto: CreateDividendPeriodDto,
  ) {
    return this.dividendsService.create(coopId, createDividendPeriodDto);
  }

  @Post('dividends/:id/calculate')
  @ApiOperation({ summary: 'Calculate dividends for a period' })
  async calculateDividends(@Param('id') id: string) {
    return this.dividendsService.calculate(id);
  }

  @Post('dividends/:id/mark-paid')
  @ApiOperation({ summary: 'Mark dividend period as paid' })
  async markDividendsPaid(
    @Param('id') id: string,
    @Body('paymentReference') paymentReference?: string,
  ) {
    return this.dividendsService.markAsPaid(id, paymentReference);
  }

  @Get('dividends/:id/export')
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

  // ==================== DOCUMENTS ====================

  @Post('shareholders/:shareholderId/certificate')
  @ApiOperation({ summary: 'Generate share certificate for a shareholder' })
  async generateCertificate(
    @Param('shareholderId') shareholderId: string,
    @Query('locale') locale?: string,
  ) {
    return this.documentsService.generateCertificate(shareholderId, locale);
  }
}
