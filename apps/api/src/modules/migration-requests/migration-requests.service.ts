import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { CreateMigrationRequestDto } from './dto/create-migration-request.dto';

@Injectable()
export class MigrationRequestsService {
  private readonly logger = new Logger(MigrationRequestsService.name);

  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
  ) {}

  async create(dto: CreateMigrationRequestDto) {
    await this.prisma.migrationRequest.create({
      data: {
        name: dto.name,
        email: dto.email.toLowerCase(),
        coopName: dto.coopName,
        estimatedShareholders: dto.estimatedShareholders,
        currentSystem: dto.currentSystem,
        message: dto.message,
        locale: dto.locale,
      },
    });

    this.sendNotificationEmail(dto).catch((err) => {
      this.logger.error('Failed to send migration request notification:', err.message);
    });

    return { message: 'Migration request submitted successfully' };
  }

  private async sendNotificationEmail(dto: CreateMigrationRequestDto) {
    await this.emailService.sendPlatformEmail({
      to: 'hello@opencoop.be',
      subject: `Migration request: ${dto.coopName}`,
      text: [
        `New migration request from ${dto.name} (${dto.email})`,
        ``,
        `Cooperative: ${dto.coopName}`,
        `Estimated shareholders: ${dto.estimatedShareholders || 'Not specified'}`,
        `Current system: ${dto.currentSystem || 'Not specified'}`,
        ``,
        `Message:`,
        dto.message,
      ].join('\n'),
    });
  }
}
