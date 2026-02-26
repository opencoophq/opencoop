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
import { AnalyticsService } from './analytics.service';
import { ReportsService } from './reports.service';
import { ShareholdersService } from '../shareholders/shareholders.service';
import { ShareClassesService } from '../shares/share-classes.service';
import { ProjectsService } from '../projects/projects.service';
import { TransactionsService } from '../transactions/transactions.service';
import { BankImportService } from '../bank-import/bank-import.service';
import { DividendsService } from '../dividends/dividends.service';
import { DocumentsService } from '../documents/documents.service';
import { CreateShareholderDto } from '../shareholders/dto/create-shareholder.dto';
import { UpdateShareholderDto } from '../shareholders/dto/update-shareholder.dto';
import { CreatePurchaseDto } from '../transactions/dto/create-purchase.dto';
import { CreateSaleDto } from '../transactions/dto/create-sale.dto';
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
    private analyticsService: AnalyticsService,
    private reportsService: ReportsService,
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

  @Post('logo')
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
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.coopsService.uploadLogo(coopId, file);
  }

  @Delete('logo')
  @ApiOperation({ summary: 'Remove coop logo' })
  async removeLogo(@Param('coopId') coopId: string) {
    await this.coopsService.removeLogo(coopId);
    return { success: true };
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

  @Post('shareholders/:shareholderId/purchase')
  @ApiOperation({ summary: 'Create a purchase on behalf of a shareholder' })
  async createPurchase(
    @Param('coopId') coopId: string,
    @Param('shareholderId') shareholderId: string,
    @Body() createPurchaseDto: CreatePurchaseDto,
  ) {
    return this.transactionsService.createPurchase({
      coopId,
      shareholderId,
      ...createPurchaseDto,
    });
  }

  @Post('shareholders/:shareholderId/sell')
  @ApiOperation({ summary: 'Create a sale on behalf of a shareholder' })
  async createSale(
    @Param('coopId') coopId: string,
    @Param('shareholderId') shareholderId: string,
    @Body() createSaleDto: CreateSaleDto,
  ) {
    return this.transactionsService.createSale({
      coopId,
      shareholderId,
      ...createSaleDto,
    });
  }

  @Get('transactions/:id/payment-details')
  @ApiOperation({ summary: 'Get payment details for a transaction (IBAN, amount, OGM for QR code)' })
  async getPaymentDetails(
    @Param('coopId') coopId: string,
    @Param('id') id: string,
  ) {
    return this.transactionsService.getPaymentDetails(id, coopId);
  }

  @Put('transactions/:id/complete')
  @ApiOperation({ summary: 'Mark an approved transaction as completed' })
  async completeTransaction(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.transactionsService.complete(id, user.id);
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

  // ==================== ANALYTICS ====================

  @Get('analytics/capital-timeline')
  @ApiOperation({ summary: 'Get capital timeline data' })
  async getCapitalTimeline(
    @Param('coopId') coopId: string,
    @Query('period') period?: string,
  ) {
    const validPeriod = ['month', 'quarter', 'year', 'all'].includes(period || '')
      ? (period as 'month' | 'quarter' | 'year' | 'all')
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
    const validPeriod = ['month', 'quarter', 'year', 'all'].includes(period || '')
      ? (period as 'month' | 'quarter' | 'year' | 'all')
      : 'month';
    return this.analyticsService.getShareholderGrowth(coopId, validPeriod);
  }

  @Get('analytics/transaction-summary')
  @ApiOperation({ summary: 'Get transaction summary data' })
  async getTransactionSummary(
    @Param('coopId') coopId: string,
    @Query('period') period?: string,
  ) {
    const validPeriod = ['month', 'quarter', 'year', 'all'].includes(period || '')
      ? (period as 'month' | 'quarter' | 'year' | 'all')
      : 'month';
    return this.analyticsService.getTransactionSummary(coopId, validPeriod);
  }

  // ==================== REPORTS ====================

  @Get('reports/annual-overview')
  @ApiOperation({ summary: 'Get annual overview report data' })
  async getAnnualOverview(
    @Param('coopId') coopId: string,
    @Query('year') year?: string,
  ) {
    const y = parseInt(year || '', 10) || new Date().getFullYear();
    return this.reportsService.getAnnualOverview(coopId, y);
  }

  @Get('reports/capital-statement')
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
  @ApiOperation({ summary: 'Get shareholder register report data' })
  async getShareholderRegister(
    @Param('coopId') coopId: string,
    @Query('date') date?: string,
  ) {
    return this.reportsService.getShareholderRegister(coopId, date);
  }

  @Get('reports/dividend-summary')
  @ApiOperation({ summary: 'Get dividend summary report data' })
  async getDividendSummary(
    @Param('coopId') coopId: string,
    @Query('year') year?: string,
  ) {
    const y = parseInt(year || '', 10) || new Date().getFullYear();
    return this.reportsService.getDividendSummary(coopId, y);
  }

  @Get('reports/project-investment')
  @ApiOperation({ summary: 'Get project investment report data' })
  async getProjectInvestment(
    @Param('coopId') coopId: string,
    @Query('projectId') projectId?: string,
  ) {
    return this.reportsService.getProjectInvestment(coopId, projectId);
  }

  @Get('reports/:type/csv')
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
  @ApiOperation({ summary: 'Generate share certificate for a shareholder' })
  async generateCertificate(
    @Param('shareholderId') shareholderId: string,
    @Query('locale') locale?: string,
  ) {
    return this.documentsService.generateCertificate(shareholderId, locale);
  }

  @Post('shareholders/:shareholderId/dividend-statement/:dividendPayoutId')
  @ApiOperation({ summary: 'Generate dividend statement for a shareholder' })
  async generateDividendStatement(
    @Param('shareholderId') shareholderId: string,
    @Param('dividendPayoutId') dividendPayoutId: string,
    @Query('locale') locale?: string,
  ) {
    return this.documentsService.generateDividendStatement(shareholderId, dividendPayoutId, locale);
  }
}
