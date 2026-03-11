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
import { AuditService } from '../audit/audit.service';
import { RegistrationsService } from '../registrations/registrations.service';
import { MessagesService } from '../messages/messages.service';
import { CreateMessageDto } from '../messages/dto/create-message.dto';
import { CreateShareholderConversationDto } from '../messages/dto/create-shareholder-conversation.dto';
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
  registrationId: string;

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
    private auditService: AuditService,
    private registrationsService: RegistrationsService,
    private documentsService: DocumentsService,
    private messagesService: MessagesService,
  ) {}

  private async verifyShareholder(shareholderId: string, userId: string) {
    const shareholder = await this.prisma.shareholder.findUnique({
      where: { id: shareholderId },
      include: { coop: { select: { id: true, minimumHoldingPeriod: true } } },
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

    // Verify the buy registration belongs to this shareholder, is active, and check holding period
    const buyRegistration = await this.prisma.registration.findFirst({
      where: { id: dto.registrationId, shareholderId, type: 'BUY', status: { in: ['ACTIVE', 'COMPLETED'] } },
    });

    if (!buyRegistration) {
      throw new NotFoundException('Active buy registration not found');
    }

    // Check minimum holding period
    const holdingMonths = shareholder.coop.minimumHoldingPeriod;
    if (holdingMonths > 0) {
      const registerDate = new Date(buyRegistration.registerDate);
      const minDate = new Date(registerDate);
      minDate.setMonth(minDate.getMonth() + holdingMonths);
      if (new Date() < minDate) {
        throw new BadRequestException(
          `Minimum holding period of ${holdingMonths} months not yet reached`,
        );
      }
    }

    return this.registrationsService.createSell({
      coopId: shareholder.coopId,
      shareholderId,
      registrationId: dto.registrationId,
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
    const shareholder = await this.verifyShareholder(shareholderId, user.id);

    const changes = this.auditService.diff(
      { bankIban: shareholder.bankIban, bankBic: shareholder.bankBic },
      { bankIban: dto.bankIban, bankBic: dto.bankBic || null },
    );

    const result = await this.prisma.shareholder.update({
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

    if (changes.length > 0) {
      await this.auditService.log({
        coopId: shareholder.coopId,
        entity: 'Shareholder',
        entityId: shareholderId,
        action: 'UPDATE',
        changes,
        actorId: user.id,
      });
    }

    return result;
  }

  @Put('profile')
  @ApiOperation({ summary: 'Update shareholder profile (self-service)' })
  async updateProfile(
    @Param('shareholderId') shareholderId: string,
    @CurrentUser() user: CurrentUserData,
    @Body() dto: UpdateProfileDto,
  ) {
    const shareholder = await this.verifyShareholder(shareholderId, user.id);

    const { address, birthDate, ...rest } = dto;

    const data: Record<string, unknown> = { ...rest };
    if (birthDate) {
      data.birthDate = new Date(birthDate);
    }
    if (address) {
      data.address = address;
    }

    const changes = this.auditService.diff(shareholder as Record<string, unknown>, data);

    const result = await this.prisma.shareholder.update({
      where: { id: shareholderId },
      data,
    });

    if (changes.length > 0) {
      await this.auditService.log({
        coopId: shareholder.coopId,
        entity: 'Shareholder',
        entityId: shareholderId,
        action: 'UPDATE',
        changes,
        actorId: user.id,
      });
    }

    return result;
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

  @Get('gift-certificate/:registrationId')
  @ApiOperation({ summary: 'Download gift certificate PDF (shareholder self-service)' })
  async downloadGiftCertificate(
    @Param('shareholderId') shareholderId: string,
    @Param('registrationId') registrationId: string,
    @CurrentUser() user: CurrentUserData,
    @Res() res: Response,
  ) {
    await this.verifyShareholder(shareholderId, user.id);

    const registration = await this.prisma.registration.findFirst({
      where: { id: registrationId, shareholderId, isGift: true },
    });

    if (!registration || !registration.giftCode) {
      throw new NotFoundException('Gift certificate not found');
    }

    const filePath = path.join(
      process.env.UPLOAD_DIR || './uploads',
      'gift-certificates',
      `${registrationId}.pdf`,
    );

    if (!fs.existsSync(filePath)) {
      // Regenerate if file was lost
      await this.documentsService.generateGiftCertificatePdf(registrationId);
    }

    if (!fs.existsSync(filePath)) {
      throw new NotFoundException('Gift certificate file not found');
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="gift-certificate-${registration.giftCode}.pdf"`);
    fs.createReadStream(filePath).pipe(res);
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

  @Post('generate-certificate/:registrationId')
  @ApiOperation({ summary: 'Generate share certificate for a specific registration (shareholder self-service)' })
  async generateCertificateForRegistration(
    @Param('shareholderId') shareholderId: string,
    @Param('registrationId') registrationId: string,
    @CurrentUser() user: CurrentUserData,
    @Body('locale') locale?: string,
  ) {
    const shareholder = await this.verifyShareholder(shareholderId, user.id);

    // Verify the registration belongs to this shareholder
    const registration = await this.prisma.registration.findFirst({
      where: { id: registrationId, shareholderId },
    });

    if (!registration) {
      throw new NotFoundException('Registration not found');
    }

    return this.documentsService.generateCertificateForRegistration(registrationId, shareholder.coopId, locale);
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

  @Post('buy')
  @ApiOperation({ summary: 'Purchase shares (shareholder self-service)' })
  async purchaseRequest(
    @Param('shareholderId') shareholderId: string,
    @CurrentUser() user: CurrentUserData,
    @Body() dto: PurchaseRequestDto,
  ) {
    const shareholder = await this.verifyShareholder(shareholderId, user.id);

    const registration = await this.registrationsService.createBuy({
      coopId: shareholder.coopId,
      shareholderId,
      shareClassId: dto.shareClassId,
      quantity: dto.quantity,
      projectId: dto.projectId,
    });

    // Return payment details so frontend can show QR code
    if (registration) {
      const paymentDetails = await this.registrationsService.getPaymentDetails(
        registration.id,
        shareholder.coopId,
      );
      return {
        registration,
        paymentDetails,
      };
    }

    return { registration };
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

  @Get('registrations')
  @ApiOperation({ summary: 'Get shareholder registrations' })
  async getRegistrations(
    @Param('shareholderId') shareholderId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    await this.verifyShareholder(shareholderId, user.id);
    return this.registrationsService.findByShareholder(shareholderId);
  }

  // ==================== MESSAGES ====================

  @Get('conversations')
  @ApiOperation({ summary: 'List conversations for this shareholder' })
  async listConversations(
    @Param('shareholderId') shareholderId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    await this.verifyShareholder(shareholderId, user.id);
    return this.messagesService.findAllForShareholder(shareholderId);
  }

  @Post('conversations')
  @ApiOperation({ summary: 'Start a new conversation with the coop' })
  async createConversation(
    @Param('shareholderId') shareholderId: string,
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreateShareholderConversationDto,
  ) {
    const shareholder = await this.verifyShareholder(shareholderId, user.id);
    return this.messagesService.createShareholderConversation(
      shareholderId, shareholder.coop.id, dto.subject, dto.body, user.id,
    );
  }

  @Get('conversations/:conversationId')
  @ApiOperation({ summary: 'Read a conversation (marks as read)' })
  async getConversation(
    @Param('shareholderId') shareholderId: string,
    @Param('conversationId') conversationId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    await this.verifyShareholder(shareholderId, user.id);
    return this.messagesService.findByIdForShareholder(conversationId, shareholderId);
  }

  @Post('conversations/:conversationId/messages')
  @ApiOperation({ summary: 'Reply to a conversation' })
  async replyToConversation(
    @Param('shareholderId') shareholderId: string,
    @Param('conversationId') conversationId: string,
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreateMessageDto,
  ) {
    await this.verifyShareholder(shareholderId, user.id);
    return this.messagesService.addShareholderReply(conversationId, shareholderId, dto.body);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Get unread conversation count for badge' })
  async getUnreadCount(
    @Param('shareholderId') shareholderId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    await this.verifyShareholder(shareholderId, user.id);
    return { count: await this.messagesService.getUnreadCount(shareholderId) };
  }

  @Get('conversations/:conversationId/attachments/:attachmentId')
  @ApiOperation({ summary: 'Download a message attachment' })
  async downloadAttachment(
    @Param('shareholderId') shareholderId: string,
    @Param('conversationId') conversationId: string,
    @Param('attachmentId') attachmentId: string,
    @CurrentUser() user: CurrentUserData,
    @Res() res: Response,
  ) {
    await this.verifyShareholder(shareholderId, user.id);

    const participant = await this.prisma.conversationParticipant.findUnique({
      where: { conversationId_shareholderId: { conversationId, shareholderId } },
    });
    if (!participant) throw new NotFoundException('Conversation not found');

    const attachment = await this.prisma.messageAttachment.findUnique({
      where: { id: attachmentId },
      include: { message: true },
    });
    if (!attachment || attachment.message.conversationId !== conversationId) {
      throw new NotFoundException('Attachment not found');
    }

    if (attachment.type === 'UPLOADED_FILE' && attachment.filePath) {
      const fullPath = path.join(process.env.UPLOAD_DIR || 'uploads', attachment.filePath);
      if (!fs.existsSync(fullPath)) throw new NotFoundException('File not found');
      const safeFilename = path.basename(attachment.fileName).replace(/["\r\n]/g, '_');
      res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
      if (attachment.mimeType) res.setHeader('Content-Type', attachment.mimeType);
      fs.createReadStream(fullPath).pipe(res);
    } else {
      throw new BadRequestException('Use document download endpoint for existing documents');
    }
  }

  @Get('referral-stats')
  @ApiOperation({ summary: 'Get referral stats for this shareholder (self-service)' })
  async getReferralStats(
    @Param('shareholderId') shareholderId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    const shareholder = await this.verifyShareholder(shareholderId, user.id);

    const referrals = await this.prisma.shareholder.findMany({
      where: { referredByShareholderId: shareholderId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        status: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const coopSlug = await this.prisma.coop.findUnique({
      where: { id: shareholder.coopId },
      select: { slug: true },
    });

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://opencoop.be';

    return {
      referralCode: shareholder.referralCode,
      referralLink: coopSlug
        ? `${appUrl}/${coopSlug.slug}/register?ref=${shareholder.referralCode}`
        : null,
      totalReferred: referrals.length,
      convertedReferred: referrals.filter((r) => r.status === 'ACTIVE').length,
      referrals: referrals.map((r) => ({
        firstName: r.firstName,
        lastInitial: r.lastName ? `${r.lastName.charAt(0)}.` : null,
        status: r.status,
        registeredAt: r.createdAt,
      })),
    };
  }
}
