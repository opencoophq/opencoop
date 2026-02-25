import { Injectable, Logger } from '@nestjs/common';
import { Octokit } from '@octokit/rest';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { CreateFeatureRequestDto } from './dto/create-feature-request.dto';

@Injectable()
export class FeatureRequestsService {
  private readonly logger = new Logger(FeatureRequestsService.name);

  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
  ) {}

  async create(dto: CreateFeatureRequestDto) {
    const featureRequest = await this.prisma.featureRequest.create({
      data: {
        name: dto.name,
        email: dto.email.toLowerCase(),
        title: dto.title,
        description: dto.description,
        locale: dto.locale,
      },
    });

    // Fire-and-forget: create GitHub issue
    this.createGitHubIssue(featureRequest.id, dto).catch((err) => {
      this.logger.error('Failed to create GitHub issue:', err.message);
    });

    // Fire-and-forget: send thank-you email
    this.sendThankYouEmail(dto).catch((err) => {
      this.logger.error('Failed to send thank-you email:', err.message);
    });

    // Fire-and-forget: notify team
    this.emailService.sendPlatformEmail({
      to: 'hello@opencoop.be',
      subject: `Feature request: ${dto.title}`,
      text: [
        `New feature request from ${dto.name} (${dto.email})`,
        ``,
        `Title: ${dto.title}`,
        ``,
        `Description:`,
        dto.description,
      ].join('\n'),
    }).catch((err) => {
      this.logger.error('Failed to send feature request notification:', err.message);
    });

    return { message: 'Feature request submitted successfully' };
  }

  private async createGitHubIssue(featureRequestId: string, dto: CreateFeatureRequestDto) {
    const token = process.env.GITHUB_TOKEN;
    if (!token) return;

    const octokit = new Octokit({ auth: token });

    const { data: issue } = await octokit.issues.create({
      owner: 'opencoophq',
      repo: 'opencoop',
      title: `[Feature Request] ${dto.title}`,
      body: [
        `**Submitted by:** ${dto.name} (${dto.email})`,
        '',
        `**Description:**`,
        dto.description,
        '',
        `---`,
        `*Submitted via the feature request form*`,
      ].join('\n'),
      labels: ['feature-request'],
    });

    await this.prisma.featureRequest.update({
      where: { id: featureRequestId },
      data: { githubIssueUrl: issue.html_url },
    });
  }

  private async sendThankYouEmail(dto: CreateFeatureRequestDto) {
    const content = this.getEmailContent(dto.locale);

    await this.emailService.sendPlatformEmail({
      to: dto.email,
      subject: content.subject,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 40px 20px;">
          <h2 style="font-size: 20px; font-weight: 600; margin-bottom: 16px;">${content.heading}</h2>
          <p style="color: #374151; line-height: 1.6; margin-bottom: 12px;">${content.body}</p>
          <p style="color: #374151; line-height: 1.6; margin-bottom: 24px;"><strong>${dto.title}</strong></p>
          <p style="color: #6b7280; font-size: 14px;">${content.closing}</p>
        </div>
      `,
    });
  }

  private getEmailContent(locale?: string): {
    subject: string;
    heading: string;
    body: string;
    closing: string;
  } {
    switch (locale) {
      case 'nl':
        return {
          subject: 'Bedankt voor je feature request — OpenCoop',
          heading: 'Bedankt voor je suggestie!',
          body: 'We hebben je feature request ontvangen en zullen deze beoordelen:',
          closing: 'Het OpenCoop-team',
        };
      case 'fr':
        return {
          subject: 'Merci pour votre suggestion — OpenCoop',
          heading: 'Merci pour votre suggestion !',
          body: 'Nous avons reçu votre demande de fonctionnalité et nous l\'examinerons :',
          closing: "L'équipe OpenCoop",
        };
      case 'de':
        return {
          subject: 'Danke für Ihren Vorschlag — OpenCoop',
          heading: 'Danke für Ihren Vorschlag!',
          body: 'Wir haben Ihre Funktionsanfrage erhalten und werden sie prüfen:',
          closing: 'Das OpenCoop-Team',
        };
      default:
        return {
          subject: 'Thanks for your feature request — OpenCoop',
          heading: 'Thanks for your suggestion!',
          body: "We've received your feature request and will review it:",
          closing: 'The OpenCoop team',
        };
    }
  }
}
