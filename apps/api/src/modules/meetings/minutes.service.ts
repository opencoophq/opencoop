import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class MinutesService {
  constructor(private prisma: PrismaService) {}

  private async assertInCoop(meetingId: string, coopId: string) {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      select: { coopId: true },
    });
    if (!meeting) throw new NotFoundException('Meeting not found');
    if (meeting.coopId !== coopId) throw new ForbiddenException();
  }

  async generateDraft(coopId: string, meetingId: string) {
    await this.assertInCoop(meetingId, coopId);
    const meeting = await this.prisma.meeting.findUniqueOrThrow({
      where: { id: meetingId },
      include: {
        agendaItems: { orderBy: { order: 'asc' }, include: { resolution: true } },
        attendances: { where: { checkedInAt: { not: null } }, include: { shareholder: true } },
        proxies: { where: { revokedAt: null }, include: { grantor: true, delegate: true } },
      },
    });

    const lines: string[] = [];
    lines.push(`# Notulen ${meeting.title}`);
    lines.push(`**Datum:** ${meeting.scheduledAt.toISOString().slice(0, 10)}`);
    lines.push(`**Locatie:** ${meeting.location ?? '—'}`);
    lines.push(`**Aanwezig:** ${meeting.attendances.length} aandeelhouders`);
    lines.push(`**Vertegenwoordigd (volmacht):** ${meeting.proxies.length}`);
    lines.push('');
    lines.push('## Agenda');
    for (const item of meeting.agendaItems) {
      lines.push(`### ${item.order}. ${item.title}`);
      if (item.description) lines.push(item.description);
      if (item.resolution) {
        const r = item.resolution;
        const outcome =
          r.passed === true ? 'AANGENOMEN' : r.passed === false ? 'VERWORPEN' : '(niet gesloten)';
        lines.push(`**Voorstel:** ${r.proposedText}`);
        lines.push(
          `**Uitslag:** ${r.votesFor} voor, ${r.votesAgainst} tegen, ${r.votesAbstain} onthoudingen — ${outcome}`,
        );
      }
      lines.push('');
    }
    const content = lines.join('\n');

    return this.prisma.meetingMinutes.upsert({
      where: { meetingId },
      create: { meetingId, content },
      update: { content },
    });
  }

  async update(coopId: string, meetingId: string, content: string) {
    await this.assertInCoop(meetingId, coopId);
    return this.prisma.meetingMinutes.update({
      where: { meetingId },
      data: { content },
    });
  }

  async finalize(coopId: string, meetingId: string, pdfUrl: string) {
    await this.assertInCoop(meetingId, coopId);
    return this.prisma.meetingMinutes.update({
      where: { meetingId },
      data: { generatedPdfUrl: pdfUrl },
    });
  }

  async uploadSigned(
    coopId: string,
    meetingId: string,
    pdfUrl: string,
    signedByName: string,
  ) {
    await this.assertInCoop(meetingId, coopId);
    return this.prisma.meetingMinutes.update({
      where: { meetingId },
      data: { signedPdfUrl: pdfUrl, signedByName, signedAt: new Date() },
    });
  }

  async get(coopId: string, meetingId: string) {
    await this.assertInCoop(meetingId, coopId);
    return this.prisma.meetingMinutes.findUnique({ where: { meetingId } });
  }
}
