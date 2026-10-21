import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CoopsService } from '../coops/coops.service';
import { EmailService } from '../email/email.service';
import { applyTokens, getCopy } from '../email/email-copy';
import { hashToken } from '../../common/crypto/hash-token';
import { MessagesService } from '../messages/messages.service';
import { PublicVolunteerSignupDto } from './dto/public-signup.dto';
import { MemberVolunteerOptInDto } from './dto/member-opt-in.dto';
import { ListVolunteersQueryDto } from './dto/list-volunteers.query';
import { MessageVolunteersDto } from './dto/message-volunteers.dto';
import { UpdateVolunteerDto } from './dto/update-volunteer.dto';
import { UpdateVolunteerInterestsDto } from './dto/update-volunteer-interests.dto';
import {
  CONSENT_TEXT_VERSION,
  CONFIRM_TTL_DAYS,
  UNCONFIRMED_RETENTION_DAYS,
  VOLUNTEER_VIEW_SELECT,
  VolunteerFilter,
  addressParts,
  applyVolunteerInterestUpdate,
  describeVolunteerInterests,
  displayName,
  hasVolunteerInterestUpdate,
  interestCatalog,
  normalizeChosenInterests,
  toVolunteerView,
  volunteerWhere,
  volunteersToCsv,
} from './volunteer-record';

const LOCALES = new Set(['nl', 'en', 'fr', 'de']);

@Injectable()
export class VolunteersService {
  private readonly logger = new Logger(VolunteersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly email: EmailService,
    private readonly messages: MessagesService,
    private readonly coops: CoopsService,
  ) {}

  async publicInfo(slug: string) {
    const coop = await this.prisma.coop.findUnique({
      where: { slug },
      select: {
        name: true,
        volunteersEnabled: true,
        volunteerInterests: true,
        channels: {
          where: { isDefault: true },
          select: { logoUrl: true, primaryColor: true },
          take: 1,
        },
      },
    });
    if (!coop?.volunteersEnabled) {
      throw new NotFoundException('Volunteer registration is not available');
    }
    const channel = coop.channels[0];
    return {
      coopName: coop.name,
      logoUrl: channel?.logoUrl ?? null,
      primaryColor: channel?.primaryColor ?? '#1e40af',
      interests: interestCatalog(coop.volunteerInterests),
      consentTextVersion: CONSENT_TEXT_VERSION,
    };
  }

  async publicSignup(
    slug: string,
    dto: PublicVolunteerSignupDto,
    actor?: { id: string; email: string } | null,
  ) {
    if (dto.website?.trim()) return { ok: true as const };

    const coop = await this.prisma.coop.findUnique({
      where: { slug },
      select: {
        id: true,
        name: true,
        volunteersEnabled: true,
        volunteerInterests: true,
        emailEnabled: true,
      },
    });
    if (!coop?.volunteersEnabled) {
      throw new NotFoundException('Volunteer registration is not available');
    }
    if (dto.consent !== true) throw new BadRequestException('Consent is required');
    if (!coop.emailEnabled) {
      throw new BadRequestException('This cooperative cannot send a confirmation email');
    }

    const email = dto.email.trim().toLowerCase();
    const interests = normalizeChosenInterests(
      dto.interests,
      interestCatalog(coop.volunteerInterests),
    );
    const locale = LOCALES.has(dto.locale ?? '') ? (dto.locale as string) : 'nl';
    const name = dto.name.trim();
    const postalCode = dto.postalCode.trim();
    const municipality = dto.municipality.trim();
    const phone = dto.phone?.trim() || null;

    const existing = await this.prisma.volunteer.findUnique({
      where: { coopId_email: { coopId: coop.id, email } },
    });
    if (existing?.status === 'ACTIVE') return { ok: true as const };

    const rawConfirm = randomBytes(32).toString('hex');
    const link = await this.linkableShareholder(coop.id, email, existing?.id, actor);
    const keepExistingLink =
      !link.shareholderId ||
      Boolean(existing?.shareholderId && existing.shareholderId !== link.shareholderId);
    const data = {
      name,
      phone,
      postalCode,
      municipality,
      interests,
      locale,
      status: 'PENDING_CONFIRMATION' as const,
      consentAt: null,
      consentTextVersion: CONSENT_TEXT_VERSION,
      confirmTokenHash: hashToken(rawConfirm),
      confirmExpiresAt: new Date(Date.now() + CONFIRM_TTL_DAYS * 24 * 60 * 60 * 1000),
      withdrawToken: existing?.withdrawToken ?? randomBytes(32).toString('hex'),
      shareholderId: keepExistingLink ? (existing?.shareholderId ?? null) : link.shareholderId,
      userId: keepExistingLink ? (existing?.userId ?? null) : link.userId,
    };

    if (existing) {
      await this.prisma.volunteer.update({ where: { id: existing.id }, data });
    } else {
      await this.prisma.volunteer.create({ data: { ...data, coopId: coop.id, email } });
    }

    await this.sendTemplate(coop.id, email, 'volunteer-confirm', locale, {
      volunteerName: name,
      coopName: coop.name,
      confirmUrl: this.pageUrl(locale, 'bevestig', rawConfirm),
    });
    return { ok: true as const };
  }

  async confirm(token: string) {
    const row = await this.prisma.volunteer.findUnique({
      where: { confirmTokenHash: hashToken(token) },
      include: { coop: { select: { id: true, name: true, emailEnabled: true } } },
    });
    if (!row || !row.confirmExpiresAt || row.confirmExpiresAt.getTime() < Date.now()) {
      throw new BadRequestException('Invalid or expired confirmation link');
    }
    if (row.status === 'WITHDRAWN') {
      throw new BadRequestException('Invalid or expired confirmation link');
    }

    const withdrawToken = row.withdrawToken ?? randomBytes(32).toString('hex');
    await this.prisma.volunteer.update({
      where: { id: row.id },
      data: {
        status: 'ACTIVE',
        consentAt: new Date(),
        consentTextVersion: CONSENT_TEXT_VERSION,
        confirmTokenHash: null,
        confirmExpiresAt: null,
        withdrawToken,
      },
    });

    if (row.coop.emailEnabled) {
      await this.sendTemplate(row.coop.id, row.email, 'volunteer-welcome', row.locale, {
        volunteerName: row.name,
        coopName: row.coop.name,
        withdrawUrl: this.pageUrl(row.locale, 'afmelden', withdrawToken),
      }).catch((err) => {
        this.logger.warn(`Welcome email failed for volunteer ${row.id}: ${(err as Error).message}`);
      });
    }
    return { ok: true as const };
  }

  async withdrawByToken(token: string) {
    const row = await this.prisma.volunteer.findUnique({ where: { withdrawToken: token } });
    if (!row) throw new BadRequestException('Invalid withdrawal link');
    if (row.status !== 'WITHDRAWN') {
      await this.prisma.volunteer.update({
        where: { id: row.id },
        data: { status: 'WITHDRAWN', confirmTokenHash: null, confirmExpiresAt: null },
      });
    }
    return { ok: true as const };
  }

  async memberView(shareholderId: string, userId: string) {
    const shareholder = await this.ownedShareholder(shareholderId, userId);
    const volunteer = await this.findMemberVolunteer(shareholder);
    const address = addressParts(shareholder.address);
    return {
      coopName: shareholder.coop.name,
      interests: interestCatalog(shareholder.coop.volunteerInterests),
      consentTextVersion: CONSENT_TEXT_VERSION,
      prefill: {
        name: displayName(shareholder),
        email: shareholder.email ?? '',
        phone: shareholder.phone ?? '',
        postalCode: address.postalCode,
        municipality: address.municipality,
      },
      volunteer: volunteer ? toVolunteerView(volunteer) : null,
    };
  }

  async memberOptIn(shareholderId: string, userId: string, dto: MemberVolunteerOptInDto) {
    if (dto.consent !== true) throw new BadRequestException('Consent is required');
    const shareholder = await this.ownedShareholder(shareholderId, userId);
    const email = shareholder.email?.trim().toLowerCase();
    if (!email) throw new BadRequestException('An email address is required');

    const address = addressParts(shareholder.address);
    const postalCode = dto.postalCode?.trim() || address.postalCode;
    const municipality = dto.municipality?.trim() || address.municipality;
    if (!postalCode || !municipality) {
      throw new BadRequestException('Postcode and municipality are required');
    }
    const interests = normalizeChosenInterests(
      dto.interests,
      interestCatalog(shareholder.coop.volunteerInterests),
    );
    const name = displayName(shareholder);
    if (!name) throw new BadRequestException('Name is required');

    const existing = await this.findMemberVolunteer(shareholder);
    if (existing?.shareholderId && existing.shareholderId !== shareholder.id) {
      throw new ConflictException('This email is already registered as a volunteer');
    }
    if (existing && existing.email !== email) {
      const emailOwner = await this.prisma.volunteer.findUnique({
        where: { coopId_email: { coopId: shareholder.coopId, email } },
      });
      if (emailOwner && emailOwner.id !== existing.id) {
        throw new ConflictException('This email is already registered as a volunteer');
      }
    }

    const wasActive = existing?.status === 'ACTIVE';
    const withdrawToken = existing?.withdrawToken ?? randomBytes(32).toString('hex');
    const data = {
      name,
      email,
      phone: dto.phone?.trim() || shareholder.phone || null,
      postalCode,
      municipality,
      interests,
      locale: LOCALES.has(shareholder.user?.preferredLanguage ?? '')
        ? shareholder.user!.preferredLanguage
        : 'nl',
      status: 'ACTIVE' as const,
      consentAt: wasActive ? (existing?.consentAt ?? new Date()) : new Date(),
      consentTextVersion: wasActive
        ? (existing?.consentTextVersion ?? CONSENT_TEXT_VERSION)
        : CONSENT_TEXT_VERSION,
      confirmTokenHash: null,
      confirmExpiresAt: null,
      withdrawToken,
      shareholderId: shareholder.id,
      userId: shareholder.userId,
    };

    const saved = existing
      ? await this.prisma.volunteer.update({
          where: { id: existing.id },
          data,
          select: VOLUNTEER_VIEW_SELECT,
        })
      : await this.prisma.volunteer.create({
          data: { ...data, coopId: shareholder.coopId },
          select: VOLUNTEER_VIEW_SELECT,
        });

    const locale = LOCALES.has(shareholder.user?.preferredLanguage ?? '')
      ? shareholder.user!.preferredLanguage
      : 'nl';
    if (!wasActive && shareholder.coop.emailEnabled) {
      await this.sendTemplate(shareholder.coopId, email, 'volunteer-welcome', locale, {
        volunteerName: name,
        coopName: shareholder.coop.name,
        withdrawUrl: this.pageUrl(locale, 'afmelden', withdrawToken),
      }).catch((err) => {
        this.logger.warn(
          `Welcome email failed for shareholder ${shareholder.id}: ${(err as Error).message}`,
        );
      });
    }
    return toVolunteerView(saved);
  }

  async memberWithdraw(shareholderId: string, userId: string) {
    const shareholder = await this.ownedShareholder(shareholderId, userId);
    const existing = await this.findMemberVolunteer(shareholder);
    if (!existing) throw new NotFoundException('Volunteer registration not found');
    const saved = await this.prisma.volunteer.update({
      where: { id: existing.id },
      data: { status: 'WITHDRAWN', confirmTokenHash: null, confirmExpiresAt: null },
      select: VOLUNTEER_VIEW_SELECT,
    });
    return toVolunteerView(saved);
  }

  async adminGet(coopId: string, id: string) {
    const row = await this.prisma.volunteer.findFirst({
      where: { id, coopId },
      select: VOLUNTEER_VIEW_SELECT,
    });
    if (!row) throw new NotFoundException('Volunteer not found');
    return toVolunteerView(row);
  }

  async adminUpdate(
    coopId: string,
    id: string,
    dto: UpdateVolunteerDto,
    actor: { userId: string; ip?: string; userAgent?: string },
  ) {
    const row = await this.prisma.volunteer.findFirst({
      where: { id, coopId },
      select: VOLUNTEER_VIEW_SELECT,
    });
    if (!row) throw new NotFoundException('Volunteer not found');
    if (dto.status === undefined && dto.interests === undefined && dto.tags === undefined) {
      throw new BadRequestException('Nothing to update');
    }

    const data: {
      interests?: string[];
      status?: 'WITHDRAWN';
      confirmTokenHash?: null;
      confirmExpiresAt?: null;
    } = {};
    const changes: { field: string; oldValue: unknown; newValue: unknown }[] = [];

    if (dto.interests !== undefined || dto.tags !== undefined) {
      const coop = await this.coopOrThrow(coopId);
      const catalog = interestCatalog(coop.volunteerInterests);
      const interests = dto.interests
        ? normalizeChosenInterests(dto.interests, catalog)
        : undefined;
      const tags = dto.tags ? normalizeChosenInterests(dto.tags, catalog) : undefined;
      if (interests && tags && interests.join('\n') !== tags.join('\n')) {
        throw new BadRequestException('tags and interests must match');
      }
      const next = interests ?? tags;
      if (!next) throw new BadRequestException('Choose at least one interest');
      if (next.join('\n') !== row.interests.join('\n')) {
        data.interests = next;
        changes.push({ field: 'interests', oldValue: row.interests, newValue: next });
      }
    }

    if (dto.status && dto.status !== row.status) {
      if (dto.status !== 'WITHDRAWN') {
        throw new BadRequestException(
          'Only a withdrawal can be recorded here. A sign-up becomes active when the person confirms the email link, and a withdrawn registration is not reactivated.',
        );
      }
      data.status = 'WITHDRAWN';
      data.confirmTokenHash = null;
      data.confirmExpiresAt = null;
      changes.push({ field: 'status', oldValue: row.status, newValue: 'WITHDRAWN' });
    }

    if (changes.length === 0) return toVolunteerView(row);

    const saved = await this.prisma.volunteer.update({
      where: { id: row.id },
      data,
      select: VOLUNTEER_VIEW_SELECT,
    });
    await this.audit.log({
      coopId,
      entity: 'Volunteer',
      entityId: row.id,
      action: 'UPDATE',
      changes,
      actorId: actor.userId,
      ipAddress: actor.ip,
      userAgent: actor.userAgent,
    });
    return toVolunteerView(saved);
  }

  async adminInterestOptions(coopId: string) {
    const coop = await this.coopOrThrow(coopId);
    return describeVolunteerInterests(coop.volunteerInterests);
  }

  async adminUpdateInterests(
    coopId: string,
    dto: UpdateVolunteerInterestsDto,
    actor: { userId: string; ip?: string; userAgent?: string },
  ) {
    const coop = await this.coopOrThrow(coopId);
    if (!hasVolunteerInterestUpdate(dto)) {
      throw new BadRequestException('Nothing to update');
    }
    const next = applyVolunteerInterestUpdate(coop.volunteerInterests, dto);
    await this.coops.update(
      coopId,
      { volunteerInterests: next },
      actor.userId,
      actor.ip,
      actor.userAgent,
    );
    return describeVolunteerInterests(next);
  }

  async adminList(coopId: string, query: ListVolunteersQueryDto) {
    const coop = await this.coopOrThrow(coopId);
    const { status, filter } = this.resolvedFilter(query);
    const where = volunteerWhere(coopId, filter, status);
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 25));
    const [rows, total, municipalities] = await Promise.all([
      this.prisma.volunteer.findMany({
        where,
        select: VOLUNTEER_VIEW_SELECT,
        orderBy: [{ municipality: 'asc' }, { name: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.volunteer.count({ where }),
      this.prisma.volunteer.findMany({
        where: { coopId, status: 'ACTIVE' },
        select: { municipality: true },
        distinct: ['municipality'],
        orderBy: { municipality: 'asc' },
      }),
    ]);
    return {
      items: rows.map((row) => toVolunteerView(row)),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      interests: interestCatalog(coop.volunteerInterests),
      municipalities: municipalities.map((row) => row.municipality),
    };
  }

  async adminExport(
    coopId: string,
    query: ListVolunteersQueryDto,
    actor: { userId: string; ip?: string; userAgent?: string },
  ) {
    await this.coopOrThrow(coopId);
    const { status, filter } = this.resolvedFilter(query);
    const where = volunteerWhere(coopId, filter, status);
    const rows = await this.prisma.volunteer.findMany({
      where,
      select: VOLUNTEER_VIEW_SELECT,
      orderBy: [{ municipality: 'asc' }, { name: 'asc' }],
    });
    const views = rows.map((row) => toVolunteerView(row));
    await this.audit.log({
      coopId,
      entity: 'Volunteer',
      entityId: coopId,
      action: 'EXPORT',
      changes: [
        {
          field: 'filters',
          oldValue: null,
          newValue: {
            municipality: query.municipality ?? null,
            postalCode: query.postalCode ?? null,
            interest: filter.interest ?? null,
            status,
          },
        },
        { field: 'rowCount', oldValue: null, newValue: views.length },
      ],
      actorId: actor.userId,
      ipAddress: actor.ip,
      userAgent: actor.userAgent,
    });
    return volunteersToCsv(views);
  }

  async adminWithdraw(
    coopId: string,
    id: string,
    actor: { userId: string; ip?: string; userAgent?: string },
  ) {
    const row = await this.prisma.volunteer.findFirst({
      where: { id, coopId },
      select: { ...VOLUNTEER_VIEW_SELECT, status: true },
    });
    if (!row) throw new NotFoundException('Volunteer not found');
    if (row.status === 'WITHDRAWN') return toVolunteerView(row);
    const saved = await this.prisma.volunteer.update({
      where: { id: row.id },
      data: { status: 'WITHDRAWN', confirmTokenHash: null, confirmExpiresAt: null },
      select: VOLUNTEER_VIEW_SELECT,
    });
    await this.audit.log({
      coopId,
      entity: 'Volunteer',
      entityId: row.id,
      action: 'UPDATE',
      changes: [{ field: 'status', oldValue: row.status, newValue: 'WITHDRAWN' }],
      actorId: actor.userId,
      ipAddress: actor.ip,
      userAgent: actor.userAgent,
    });
    return toVolunteerView(saved);
  }

  async adminDelete(
    coopId: string,
    id: string,
    actor: { userId: string; ip?: string; userAgent?: string },
  ) {
    const row = await this.prisma.volunteer.findFirst({
      where: { id, coopId },
      select: { id: true, status: true },
    });
    if (!row) throw new NotFoundException('Volunteer not found');
    await this.prisma.volunteer.delete({ where: { id: row.id } });
    await this.audit.log({
      coopId,
      entity: 'Volunteer',
      entityId: row.id,
      action: 'DELETE',
      changes: [{ field: 'status', oldValue: row.status, newValue: null }],
      actorId: actor.userId,
      ipAddress: actor.ip,
      userAgent: actor.userAgent,
    });
    return { ok: true as const };
  }

  async adminMessage(
    coopId: string,
    dto: MessageVolunteersDto,
    actor: { userId: string; ip?: string; userAgent?: string },
  ) {
    await this.coopOrThrow(coopId);
    try {
      return await this.messages.createConversation(
        coopId,
        {
          type: 'BROADCAST',
          subject: dto.subject.trim(),
          body: dto.body,
          audience: {
            type: 'VOLUNTEERS',
            volunteerFilter: {
              municipality: dto.municipality,
              postalCode: dto.postalCode,
              interest: dto.interest,
            },
          },
        },
        actor.userId,
        actor.ip,
        actor.userAgent,
      );
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw error;
    }
  }

  async purgeUnconfirmed(now = new Date()) {
    const cutoff = new Date(now.getTime() - UNCONFIRMED_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const where = { status: 'PENDING_CONFIRMATION' as const, createdAt: { lt: cutoff } };
    const grouped = await this.prisma.volunteer.groupBy({
      by: ['coopId'],
      where,
      _count: { _all: true },
    });
    if (grouped.length === 0) return { purged: 0 };
    const result = await this.prisma.volunteer.deleteMany({ where });
    for (const group of grouped) {
      await this.audit.log({
        coopId: group.coopId,
        entity: 'Volunteer',
        entityId: group.coopId,
        action: 'DELETE',
        changes: [{ field: 'purgedUnconfirmed', oldValue: null, newValue: group._count._all }],
      });
    }
    this.logger.log(`Purged ${result.count} unconfirmed volunteer signup(s)`);
    return { purged: result.count };
  }

  /**
   * A public signup is linked only when the visitor is logged in and the
   * form email is that user's email. An anonymous signup that happens to
   * use a member's address stays unlinked until that member opts in.
   */
  private async linkableShareholder(
    coopId: string,
    email: string,
    existingVolunteerId?: string,
    actor?: { id: string; email: string } | null,
  ) {
    const none = { shareholderId: null as string | null, userId: null as string | null };
    if (!actor || actor.email.trim().toLowerCase() !== email) return none;
    const matches = await this.prisma.shareholder.findMany({
      where: { coopId, userId: actor.id },
      select: { id: true, userId: true, email: true },
      take: 10,
    });
    const shareholder =
      matches.find((row) => row.email?.trim().toLowerCase() === email) ?? matches[0];
    if (!shareholder) return none;
    const linked = await this.prisma.volunteer.findUnique({
      where: { shareholderId: shareholder.id },
      select: { id: true },
    });
    if (linked && linked.id !== existingVolunteerId) return none;
    return { shareholderId: shareholder.id, userId: shareholder.userId };
  }

  private async ownedShareholder(shareholderId: string, userId: string) {
    const shareholder = await this.prisma.shareholder.findFirst({
      where: { id: shareholderId, userId },
      select: {
        id: true,
        coopId: true,
        userId: true,
        type: true,
        email: true,
        phone: true,
        firstName: true,
        lastName: true,
        companyName: true,
        address: true,
        user: { select: { preferredLanguage: true } },
        coop: {
          select: {
            id: true,
            name: true,
            volunteersEnabled: true,
            volunteerInterests: true,
            emailEnabled: true,
          },
        },
      },
    });
    if (!shareholder) throw new NotFoundException('Shareholder not found');
    if (!shareholder.coop.volunteersEnabled) {
      throw new NotFoundException('Volunteer registration is not available');
    }
    return shareholder;
  }

  private async findMemberVolunteer(shareholder: {
    id: string;
    coopId: string;
    email: string | null;
  }) {
    const byShareholder = await this.prisma.volunteer.findUnique({
      where: { shareholderId: shareholder.id },
      select: { ...VOLUNTEER_VIEW_SELECT, withdrawToken: true, email: true, consentAt: true },
    });
    if (byShareholder) return byShareholder;
    const email = shareholder.email?.trim().toLowerCase();
    if (!email) return null;
    return this.prisma.volunteer.findUnique({
      where: { coopId_email: { coopId: shareholder.coopId, email } },
      select: { ...VOLUNTEER_VIEW_SELECT, withdrawToken: true, email: true, consentAt: true },
    });
  }

  private resolvedFilter(query: ListVolunteersQueryDto): {
    status: 'PENDING_CONFIRMATION' | 'ACTIVE' | 'WITHDRAWN' | 'ALL';
    filter: VolunteerFilter;
  } {
    if (
      query.interest &&
      query.tag &&
      query.interest.trim().toLowerCase() !== query.tag.trim().toLowerCase()
    ) {
      throw new BadRequestException('interest and tag filters must match');
    }
    return {
      status: query.status ?? 'ACTIVE',
      filter: {
        municipality: query.municipality,
        postalCode: query.postalCode,
        interest: query.interest ?? query.tag,
      },
    };
  }

  private async coopOrThrow(coopId: string) {
    const coop = await this.prisma.coop.findUnique({
      where: { id: coopId },
      select: { id: true, volunteerInterests: true, volunteersEnabled: true },
    });
    if (!coop) throw new NotFoundException('Cooperative not found');
    return coop;
  }

  private pageUrl(locale: string, action: 'bevestig' | 'afmelden', token: string) {
    const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://opencoop.be').replace(/\/$/, '');
    const safeLocale = LOCALES.has(locale) ? locale : 'nl';
    return `${base}/${safeLocale}/vrijwilligers/${action}/${token}`;
  }

  private async sendTemplate(
    coopId: string,
    to: string,
    templateKey: 'volunteer-confirm' | 'volunteer-welcome' | 'volunteer-message',
    locale: string,
    tokens: Record<string, string>,
  ) {
    const copy = getCopy(templateKey, locale);
    const subject = applyTokens(copy.subject || templateKey, {
      coopName: tokens.coopName ?? '',
      messageSubject: tokens.messageSubject ?? '',
    });
    await this.email.send({
      coopId,
      to,
      subject,
      templateKey,
      templateData: { ...tokens, language: locale },
    });
  }
}
