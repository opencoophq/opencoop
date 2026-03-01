import {
  Controller,
  Post,
  Put,
  Get,
  Res,
  StreamableFile,
  Body,
  Param,
  UseGuards,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { TransactionsService } from '../transactions/transactions.service';
import { IsString, IsInt, IsOptional, Min, ValidateNested, IsObject, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';
import { AddressDto } from './dto/create-shareholder.dto';
import { DocumentsService } from '../documents/documents.service';
import * as fs from 'fs';
import * as path from 'path';

class PurchaseRequestDto {
  @IsString()
  shareClassId: string;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsOptional()
  @IsString()
  projectId?: string;
}

class SellRequestDto {
  @IsString()
  shareId: string;

  @IsInt()
  @Min(1)
  quantity: number;
}

class UpdateBankDetailsDto {
  @IsString()
  bankIban: string;

  @IsOptional()
  @IsString()
  bankBic?: string;
}

class UpdateProfileAddressDto {
  @IsOptional()
  @IsString()
  street?: string;

  @IsOptional()
  @IsString()
  number?: string;

  @IsOptional()
  @IsString()
  postalCode?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  country?: string;
}

class UpdateProfileDto {
  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsDateString()
  birthDate?: string;

  @IsOptional()
  @IsString()
  companyName?: string;

  @IsOptional()
  @IsString()
  companyId?: string;

  @IsOptional()
  @IsString()
  vatNumber?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => UpdateProfileAddressDto)
  address?: UpdateProfileAddressDto;

  @IsOptional()
  @IsString()
  bankIban?: string;

  @IsOptional()
  @IsString()
  bankBic?: string;
}

@ApiTags('shareholder-actions')
@Controller('shareholders/:shareholderId')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ShareholderActionsController {
  constructor(
    private prisma: PrismaService,
    private transactionsService: TransactionsService,
    private documentsService: DocumentsService,
  ) {}

  private async verifyShareholder(shareholderId: string, userId: string) {
    const shareholder = await this.prisma.shareholder.findUnique({
      where: { id: shareholderId },
      include: { coop: { select: { minimumHoldingPeriod: true } } },
    });

    if (!shareholder) {
      throw new NotFoundException('Shareholder not found');
    }

    if (shareholder.userId !== userId) {
      throw new ForbiddenException('You can only manage your own shareholder records');
    }

    return shareholder;
  }

  @Post('sell-request')
  @ApiOperation({ summary: 'Request to sell shares (shareholder self-service)' })
  async sellRequest(
    @Param('shareholderId') shareholderId: string,
    @CurrentUser() user: CurrentUserData,
    @Body() dto: SellRequestDto,
  ) {
    const shareholder = await this.verifyShareholder(shareholderId, user.id);

    // Verify shareholder has bank details
    if (!shareholder.bankIban) {
      throw new BadRequestException('Bank account (IBAN) is required before selling shares');
    }

    // Verify share belongs to shareholder
    const share = await this.prisma.share.findFirst({
      where: { id: dto.shareId, shareholderId },
    });

    if (!share) {
      throw new NotFoundException('Share not found');
    }

    if (share.status !== 'ACTIVE') {
      throw new BadRequestException('Only active shares can be sold');
    }

    // Check minimum holding period
    const holdingMonths = shareholder.coop.minimumHoldingPeriod;
    if (holdingMonths > 0) {
      const purchaseDate = new Date(share.purchaseDate);
      const minDate = new Date(purchaseDate);
      minDate.setMonth(minDate.getMonth() + holdingMonths);
      if (new Date() < minDate) {
        throw new BadRequestException(
          `Minimum holding period of ${holdingMonths} months not yet reached`,
        );
      }
    }

    return this.transactionsService.createSale({
      coopId: shareholder.coopId,
      shareholderId,
      shareId: dto.shareId,
      quantity: dto.quantity,
    });
  }

  @Put('bank-details')
  @ApiOperation({ summary: 'Update shareholder bank details' })
  async updateBankDetails(
    @Param('shareholderId') shareholderId: string,
    @CurrentUser() user: CurrentUserData,
    @Body() dto: UpdateBankDetailsDto,
  ) {
    await this.verifyShareholder(shareholderId, user.id);

    return this.prisma.shareholder.update({
      where: { id: shareholderId },
      data: {
        bankIban: dto.bankIban,
        bankBic: dto.bankBic || null,
      },
      select: {
        id: true,
        bankIban: true,
        bankBic: true,
      },
    });
  }

  @Put('profile')
  @ApiOperation({ summary: 'Update shareholder profile (self-service)' })
  async updateProfile(
    @Param('shareholderId') shareholderId: string,
    @CurrentUser() user: CurrentUserData,
    @Body() dto: UpdateProfileDto,
  ) {
    await this.verifyShareholder(shareholderId, user.id);

    const { address, birthDate, ...rest } = dto;

    const data: Record<string, unknown> = { ...rest };
    if (birthDate) {
      data.birthDate = new Date(birthDate);
    }
    if (address) {
      data.address = address;
    }

    return this.prisma.shareholder.update({
      where: { id: shareholderId },
      data,
    });
  }

  @Get('documents/:documentId/download')
  @ApiOperation({ summary: 'Download a document (shareholder self-service)' })
  async downloadDocument(
    @Param('shareholderId') shareholderId: string,
    @Param('documentId') documentId: string,
    @CurrentUser() user: CurrentUserData,
    @Res() res: Response,
  ) {
    await this.verifyShareholder(shareholderId, user.id);

    const doc = await this.prisma.shareholderDocument.findFirst({
      where: { id: documentId, shareholderId },
    });

    if (!doc) {
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

  @Post('generate-certificate')
  @ApiOperation({ summary: 'Generate share certificate (shareholder self-service)' })
  async generateCertificate(
    @Param('shareholderId') shareholderId: string,
    @CurrentUser() user: CurrentUserData,
    @Body('locale') locale?: string,
  ) {
    await this.verifyShareholder(shareholderId, user.id);
    return this.documentsService.generateCertificate(shareholderId, locale);
  }

  @Post('generate-dividend-statement/:dividendPayoutId')
  @ApiOperation({ summary: 'Generate dividend statement (shareholder self-service)' })
  async generateDividendStatement(
    @Param('shareholderId') shareholderId: string,
    @Param('dividendPayoutId') dividendPayoutId: string,
    @CurrentUser() user: CurrentUserData,
    @Body('locale') locale?: string,
  ) {
    await this.verifyShareholder(shareholderId, user.id);

    // Verify the payout belongs to this shareholder
    const payout = await this.prisma.dividendPayout.findFirst({
      where: { id: dividendPayoutId, shareholderId },
    });

    if (!payout) {
      throw new NotFoundException('Dividend payout not found');
    }

    return this.documentsService.generateDividendStatement(shareholderId, dividendPayoutId, locale);
  }

  @Post('purchase')
  @ApiOperation({ summary: 'Purchase shares (shareholder self-service)' })
  async purchaseRequest(
    @Param('shareholderId') shareholderId: string,
    @CurrentUser() user: CurrentUserData,
    @Body() dto: PurchaseRequestDto,
  ) {
    const shareholder = await this.verifyShareholder(shareholderId, user.id);

    const transaction = await this.transactionsService.createPurchase({
      coopId: shareholder.coopId,
      shareholderId,
      shareClassId: dto.shareClassId,
      quantity: dto.quantity,
      projectId: dto.projectId,
    });

    // Return payment details so frontend can show QR code
    if (transaction) {
      const paymentDetails = await this.transactionsService.getPaymentDetails(
        transaction.id,
        shareholder.coopId,
      );
      return {
        transaction,
        paymentDetails,
      };
    }

    return { transaction };
  }

  @Get('share-classes')
  @ApiOperation({ summary: 'Get available share classes for purchasing' })
  async getShareClasses(
    @Param('shareholderId') shareholderId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    const shareholder = await this.verifyShareholder(shareholderId, user.id);

    return this.prisma.shareClass.findMany({
      where: { coopId: shareholder.coopId, isActive: true },
      select: {
        id: true,
        name: true,
        code: true,
        pricePerShare: true,
        minShares: true,
        maxShares: true,
      },
    });
  }

  @Get('transactions')
  @ApiOperation({ summary: 'Get shareholder transactions' })
  async getTransactions(
    @Param('shareholderId') shareholderId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    await this.verifyShareholder(shareholderId, user.id);
    return this.transactionsService.findByShareholder(shareholderId);
  }
}
