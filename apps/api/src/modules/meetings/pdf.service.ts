import React from 'react';
import { Injectable, NotFoundException } from '@nestjs/common';
import { renderToBuffer } from '@react-pdf/renderer';
import {
  ConvocationPdf,
  VolmachtFormPdf,
  AttendanceSheetPdf,
  MeetingMinutesPdf,
} from '@opencoop/pdf-templates';
import { PrismaService } from '../../prisma/prisma.service';

type SupportedLanguage = 'nl' | 'en' | 'fr' | 'de';

interface AttendanceRsvpRow {
  shareholderName: string;
  shareholderNumber: string;
  attendingVia: 'IN_PERSON' | 'VOLMACHT_TO';
  delegateName?: string;
}

function resolveLanguage(pref?: string | null): SupportedLanguage {
  const lang = (pref ?? '').toLowerCase();
  if (lang === 'nl' || lang === 'en' || lang === 'fr' || lang === 'de') {
    return lang;
  }
  return 'nl';
}

function formatAddress(addr: unknown): string {
  if (!addr) return '';
  if (typeof addr === 'string') return addr;
  if (typeof addr === 'object') {
    const a = addr as Record<string, unknown>;
    const street = [a.street, a.number].filter(Boolean).join(' ');
    const city = [a.postalCode, a.city].filter(Boolean).join(' ');
    return [street, city, a.country].filter(Boolean).join(', ');
  }
  return '';
}

function displayName(sh: {
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
}): string {
  if (sh.companyName) return sh.companyName;
  return `${sh.firstName ?? ''} ${sh.lastName ?? ''}`.trim();
}

@Injectable()
export class MeetingPdfService {
  constructor(private prisma: PrismaService) {}

  async convocation(
    coopId: string,
    meetingId: string,
    shareholderId: string,
  ): Promise<Buffer> {
    const meeting = await this.prisma.meeting.findUniqueOrThrow({
      where: { id: meetingId },
      include: { coop: true, agendaItems: { orderBy: { order: 'asc' } } },
    });
    if (meeting.coopId !== coopId) throw new NotFoundException();

    const sh = await this.prisma.shareholder.findUniqueOrThrow({
      where: { id: shareholderId },
      include: { user: { select: { preferredLanguage: true } } },
    });
    if (sh.coopId !== coopId) throw new NotFoundException();

    const language = resolveLanguage(sh.user?.preferredLanguage);

    const element = React.createElement(ConvocationPdf, {
      coop: {
        name: meeting.coop.name,
        address: formatAddress(meeting.coop.coopAddress),
        companyId: meeting.coop.vatNumber ?? '',
        logoUrl: meeting.coop.logoUrl ?? undefined,
      },
      shareholder: {
        firstName: sh.firstName ?? '',
        lastName: sh.lastName ?? '',
        address: formatAddress(sh.address) || undefined,
      },
      meeting: {
        title: meeting.title,
        scheduledAt: meeting.scheduledAt,
        location: meeting.location ?? '',
        agendaItems: meeting.agendaItems.map((item) => ({
          order: item.order,
          title: item.title,
          description: item.description,
        })),
      },
      language,
    });
    return renderToBuffer(element as any);
  }

  async volmacht(
    coopId: string,
    meetingId: string,
    shareholderId: string,
    delegateId?: string,
  ): Promise<Buffer> {
    const meeting = await this.prisma.meeting.findUniqueOrThrow({
      where: { id: meetingId },
      include: { coop: true },
    });
    if (meeting.coopId !== coopId) throw new NotFoundException();

    const sh = await this.prisma.shareholder.findUniqueOrThrow({
      where: { id: shareholderId },
      include: { user: { select: { preferredLanguage: true } } },
    });
    if (sh.coopId !== coopId) throw new NotFoundException();

    const delegate = delegateId
      ? await this.prisma.shareholder.findUnique({ where: { id: delegateId } })
      : null;
    if (delegate && delegate.coopId !== coopId) {
      throw new NotFoundException();
    }

    const language = resolveLanguage(sh.user?.preferredLanguage);

    const element = React.createElement(VolmachtFormPdf, {
      coop: {
        name: meeting.coop.name,
        address: formatAddress(meeting.coop.coopAddress),
        companyId: meeting.coop.vatNumber ?? '',
      },
      grantor: {
        firstName: sh.firstName ?? '',
        lastName: sh.lastName ?? '',
        address: formatAddress(sh.address) || undefined,
        shareholderNumber: String(sh.memberNumber ?? ''),
      },
      delegate: delegate
        ? {
            firstName: delegate.firstName ?? '',
            lastName: delegate.lastName ?? '',
          }
        : undefined,
      meeting: { title: meeting.title, scheduledAt: meeting.scheduledAt },
      language,
    });
    return renderToBuffer(element as any);
  }

  async attendanceSheet(coopId: string, meetingId: string): Promise<Buffer> {
    const meeting = await this.prisma.meeting.findUniqueOrThrow({
      where: { id: meetingId },
      include: {
        coop: true,
        attendances: {
          where: { OR: [{ rsvpStatus: 'ATTENDING' }, { rsvpStatus: 'PROXY' }] },
          include: { shareholder: true },
          orderBy: [
            { shareholder: { lastName: 'asc' } },
            { shareholder: { firstName: 'asc' } },
          ],
        },
        proxies: {
          where: { revokedAt: null },
          include: { grantor: true, delegate: true },
        },
      },
    });
    if (meeting.coopId !== coopId) throw new NotFoundException();

    const proxyByGrantor = new Map(
      meeting.proxies.map((p) => [p.grantorShareholderId, p] as const),
    );

    const rsvps: AttendanceRsvpRow[] = [];
    for (const att of meeting.attendances) {
      if (att.rsvpStatus === 'ATTENDING') {
        rsvps.push({
          shareholderName: displayName(att.shareholder),
          shareholderNumber: String(att.shareholder.memberNumber ?? ''),
          attendingVia: 'IN_PERSON',
        });
      } else if (att.rsvpStatus === 'PROXY') {
        const proxy = proxyByGrantor.get(att.shareholderId);
        if (!proxy) continue;
        const delegateAttending = meeting.attendances.find(
          (a) =>
            a.shareholderId === proxy.delegateShareholderId &&
            a.rsvpStatus === 'ATTENDING',
        );
        if (!delegateAttending) continue;
        rsvps.push({
          shareholderName: displayName(att.shareholder),
          shareholderNumber: String(att.shareholder.memberNumber ?? ''),
          attendingVia: 'VOLMACHT_TO',
          delegateName: displayName(proxy.delegate),
        });
      }
    }

    const element = React.createElement(AttendanceSheetPdf, {
      coop: {
        name: meeting.coop.name,
        address: formatAddress(meeting.coop.coopAddress),
      },
      meeting: {
        title: meeting.title,
        scheduledAt: meeting.scheduledAt,
        location: meeting.location ?? '',
      },
      rsvps,
      language: 'nl',
    });
    return renderToBuffer(element as any);
  }

  async minutes(coopId: string, meetingId: string): Promise<Buffer> {
    const meeting = await this.prisma.meeting.findUniqueOrThrow({
      where: { id: meetingId },
      include: { coop: true, minutes: true },
    });
    if (meeting.coopId !== coopId) throw new NotFoundException();

    const content = meeting.minutes?.content ?? '(Notulen niet gegenereerd)';

    const element = React.createElement(MeetingMinutesPdf, {
      coop: { name: meeting.coop.name },
      meeting: {
        title: meeting.title,
        scheduledAt: meeting.scheduledAt,
        location: meeting.location ?? '',
      },
      content,
      signedByName: meeting.minutes?.signedByName ?? undefined,
    });
    return renderToBuffer(element as any);
  }
}
