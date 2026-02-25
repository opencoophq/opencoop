import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateMigrationRequestDto } from './dto/create-migration-request.dto';

@Injectable()
export class MigrationRequestsService {
  private readonly logger = new Logger(MigrationRequestsService.name);

  constructor(private prisma: PrismaService) {}

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
    const host = process.env.SMTP_HOST;
    if (!host) return;

    const transporter = nodemailer.createTransport({
      host,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    await transporter.sendMail({
      from: process.env.SMTP_FROM || 'noreply@opencoop.be',
      to: process.env.SMTP_FROM || 'info@opencoop.be',
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
