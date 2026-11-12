import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { AuditService } from '../audit/audit.service';
import { AuthEmailService } from '../auth/auth-email.service';
import { hashToken } from '../../common/crypto';
import { activePendingEmail, CLEAR_PENDING_EMAIL } from '../auth/pending-email';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { InviteAdminDto } from './dto/invite-admin.dto';
import { CoopPermissions } from '@opencoop/shared';

/** How long the verify link for a requested login email change stays valid. */
const EMAIL_CHANGE_TTL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class CoopAdminsService {
  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
    private auditService: AuditService,
    private authEmail: AuthEmailService,
  ) {}

  // ==================== ROLES ====================

  async getRoles(coopId: string) {
    const roles = await this.prisma.coopRole.findMany({
      where: { coopId },
      // `coopAdminRoles` is the new source of truth for role membership;
      // `coopAdmins` (single-role legacy back-relation) is no longer written.
      include: { _count: { select: { coopAdminRoles: true } } },
    });

    // Default roles in logical order, then custom roles alphabetically
    const defaultOrder: Record<string, number> = {
      Admin: 1,
      Manager: 2,
      Viewer: 3,
      'GDPR Viewer': 4,
    };

    return roles.sort((a, b) => {
      const aDefault = a.isDefault ? (defaultOrder[a.name] ?? 99) : 100;
      const bDefault = b.isDefault ? (defaultOrder[b.name] ?? 99) : 100;
      if (aDefault !== bDefault) return aDefault - bDefault;
      return a.name.localeCompare(b.name);
    });
  }

  async createRole(coopId: string, dto: CreateRoleDto) {
    return this.prisma.coopRole.create({
      data: {
        coopId,
        name: dto.name,
        permissions: dto.permissions as any,
        isDefault: false,
      },
    });
  }

  async updateRole(coopId: string, roleId: string, dto: UpdateRoleDto) {
    const role = await this.prisma.coopRole.findFirst({
      where: { id: roleId, coopId },
    });
    if (!role) {
      throw new NotFoundException('Role not found');
    }

    return this.prisma.coopRole.update({
      where: { id: roleId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.permissions !== undefined && { permissions: dto.permissions as any }),
      },
    });
  }

  async deleteRole(coopId: string, roleId: string) {
    const role = await this.prisma.coopRole.findFirst({
      where: { id: roleId, coopId },
      include: { _count: { select: { coopAdminRoles: true } } },
    });
    if (!role) {
      throw new NotFoundException('Role not found');
    }
    if (role.isDefault) {
      throw new BadRequestException('Cannot delete a default role');
    }
    if (role._count.coopAdminRoles > 0) {
      throw new BadRequestException(
        'Reassign all administrators using this role before deleting it',
      );
    }

    return this.prisma.coopRole.delete({ where: { id: roleId } });
  }

  // ==================== ADMINS ====================

  async getAdmins(coopId: string) {
    return this.prisma.coopAdmin.findMany({
      where: { coopId },
      select: {
        id: true,
        permissionOverrides: true,
        createdAt: true,
        user: {
          select: { id: true, email: true, name: true, role: true },
        },
        roles: {
          select: {
            role: { select: { id: true, name: true, permissions: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async updateAdminPermissionOverrides(
    coopId: string,
    adminId: string,
    overrides: Record<string, boolean> | null,
  ) {
    const admin = await this.prisma.coopAdmin.findFirst({
      where: { id: adminId, coopId },
    });
    if (!admin) {
      throw new NotFoundException('Admin not found');
    }

    return this.prisma.coopAdmin.update({
      where: { id: adminId },
      data: { permissionOverrides: overrides === null ? Prisma.JsonNull : overrides },
      include: {
        user: { select: { id: true, email: true, name: true, role: true } },
        roles: { select: { role: { select: { id: true, name: true, permissions: true } } } },
      },
    });
  }

  /**
   * Replace the full set of roles assigned to an admin. Empty array is
   * rejected — every admin must have at least one role (otherwise they'd
   * have no permissions and just a stub `CoopAdmin` row that the auth
   * service would issue an empty permissions object for).
   */
  async updateAdminRoles(coopId: string, adminId: string, roleIds: string[]) {
    const admin = await this.prisma.coopAdmin.findFirst({
      where: { id: adminId, coopId },
    });
    if (!admin) {
      throw new NotFoundException('Admin not found');
    }

    if (!Array.isArray(roleIds) || roleIds.length === 0) {
      throw new BadRequestException('At least one role is required');
    }

    // Validate every role belongs to this coop so we can't assign a role
    // from another coop.
    const validRoles = await this.prisma.coopRole.findMany({
      where: { id: { in: roleIds }, coopId },
      select: { id: true },
    });
    if (validRoles.length !== roleIds.length) {
      throw new NotFoundException('One or more roles not found in this cooperative');
    }

    // Replace: delete all existing assignments for this admin, then insert
    // the new ones in a single transaction.
    await this.prisma.$transaction([
      this.prisma.coopAdminRole.deleteMany({ where: { coopAdminId: adminId } }),
      this.prisma.coopAdminRole.createMany({
        data: roleIds.map((roleId) => ({ coopAdminId: adminId, roleId })),
      }),
    ]);

    return this.prisma.coopAdmin.findUnique({
      where: { id: adminId },
      include: {
        user: { select: { id: true, email: true, name: true, role: true } },
        roles: { select: { role: { select: { id: true, name: true, permissions: true } } } },
      },
    });
  }

  async removeAdmin(coopId: string, adminId: string) {
    const admin = await this.prisma.coopAdmin.findFirst({
      where: { id: adminId, coopId },
      include: { roles: { select: { role: { select: { permissions: true } } } } },
    });
    if (!admin) {
      throw new NotFoundException('Admin not found');
    }

    // The last admin with `canManageAdmins` can't remove themselves —
    // otherwise nobody is left who can manage admins. Compute effective
    // permissions per admin via OR-merge across their roles.
    const adminsWithRoles = await this.prisma.coopAdmin.findMany({
      where: { coopId },
      include: { roles: { select: { role: { select: { permissions: true } } } } },
    });
    const canManageAdminsCount = adminsWithRoles.filter((a) =>
      a.roles.some((r) => (r.role.permissions as any)?.canManageAdmins === true),
    ).length;
    const targetCanManageAdmins = admin.roles.some(
      (r) => (r.role.permissions as any)?.canManageAdmins === true,
    );
    if (canManageAdminsCount <= 1 && targetCanManageAdmins) {
      throw new BadRequestException(
        'Cannot remove the last administrator with management permissions',
      );
    }

    // Delete CoopAdmin entry (cascades to coop_admin_roles)
    await this.prisma.coopAdmin.delete({ where: { id: adminId } });

    // Check if user still admins any other coop
    const remainingAdminEntries = await this.prisma.coopAdmin.count({
      where: { userId: admin.userId },
    });
    // If no more coop admin entries, downgrade a COOP_ADMIN to SHAREHOLDER.
    // The role filter keeps a system admin's global role untouched: a coop
    // admin may drop them from this team, never demote them.
    if (remainingAdminEntries === 0) {
      await this.prisma.user.updateMany({
        where: { id: admin.userId, role: 'COOP_ADMIN' },
        data: { role: 'SHAREHOLDER' },
      });
    }

    return { success: true };
  }

  // ==================== INVITATIONS ====================

  async inviteAdmin(coopId: string, dto: InviteAdminDto) {
    const coop = await this.prisma.coop.findUnique({ where: { id: coopId } });
    if (!coop) {
      throw new NotFoundException('Cooperative not found');
    }

    if (!Array.isArray(dto.roleIds) || dto.roleIds.length === 0) {
      throw new BadRequestException('At least one role is required');
    }

    const roles = await this.prisma.coopRole.findMany({
      where: { id: { in: dto.roleIds }, coopId },
      select: { id: true, name: true },
    });
    if (roles.length !== dto.roleIds.length) {
      throw new NotFoundException('One or more roles not found in this cooperative');
    }

    // Check if user is already an admin of this coop
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });
    if (existingUser) {
      const existingAdmin = await this.prisma.coopAdmin.findUnique({
        where: { userId_coopId: { userId: existingUser.id, coopId } },
      });
      if (existingAdmin) {
        throw new ConflictException('This user is already an admin of this cooperative');
      }
    }

    // The admin check above passed, so any invitation for this coop and email
    // is stale, accepted or not. Delete it first or the unique key fails.
    // Deleting cascades to the join rows.
    const existingInvitation = await this.prisma.adminInvitation.findUnique({
      where: { coopId_email: { coopId, email: dto.email.toLowerCase() } },
    });
    if (existingInvitation) {
      await this.prisma.adminInvitation.delete({ where: { id: existingInvitation.id } });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const invitation = await this.prisma.adminInvitation.create({
      data: {
        coopId,
        email: dto.email.toLowerCase(),
        token,
        expiresAt,
        roles: {
          create: dto.roleIds.map((roleId) => ({ roleId })),
        },
      },
      include: {
        roles: { include: { role: { select: { id: true, name: true } } } },
      },
    });

    await this.sendInvitationEmail({
      email: dto.email,
      token,
      coopId,
      coopName: coop.name,
      roleNames: roles.map((r) => r.name),
    });

    return invitation;
  }

  /**
   * Send (or re-send) the invitation email. Extracted so the resend flow
   * can reuse the exact same template — no drift between first-send and
   * follow-up. Failures are logged, not raised, because the invitation
   * row already exists in the DB; the admin can hit Resend if the email
   * provider was transiently down.
   */
  private async sendInvitationEmail(args: {
    email: string;
    token: string;
    coopId: string;
    coopName: string;
    roleNames: string[];
  }): Promise<void> {
    const appUrl = process.env.FRONTEND_URL || 'http://localhost:3002';
    const inviteUrl = `${appUrl}/invite/${args.token}`;
    const rolesLabel = args.roleNames.join(', ') || '—';

    await this.emailService
      .sendPlatformEmail({
        to: args.email,
        subject: `You've been invited to manage ${args.coopName} on OpenCoop`,
        templateKey: 'admin-invitation',
        coopId: args.coopId,
        html: `
        <h2>You've been invited to ${args.coopName}</h2>
        <p>You've been invited as <strong>${rolesLabel}</strong> for the cooperative <strong>${args.coopName}</strong> on OpenCoop.</p>
        <p><a href="${inviteUrl}" style="display:inline-block;padding:12px 24px;background-color:#1e40af;color:#fff;text-decoration:none;border-radius:6px;">Accept Invitation</a></p>
        <p>This invitation expires in 7 days.</p>
        <p>If you didn't expect this invitation, you can safely ignore this email.</p>
      `,
      })
      .catch((err) => {
        console.error('Failed to send admin invitation email:', err.message);
      });
  }

  /**
   * Resend a still-pending invitation. Rotates the token (so any old
   * email link is invalidated — the invitee must use the latest one)
   * and extends the expiry by another 7 days from now.
   */
  async resendInvitation(coopId: string, invitationId: string) {
    const invitation = await this.prisma.adminInvitation.findFirst({
      where: { id: invitationId, coopId, accepted: false },
      include: {
        coop: { select: { name: true } },
        roles: { include: { role: { select: { name: true } } } },
      },
    });
    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }

    const newToken = crypto.randomBytes(32).toString('hex');
    const newExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const updated = await this.prisma.adminInvitation.update({
      where: { id: invitation.id },
      data: { token: newToken, expiresAt: newExpiry },
    });

    await this.sendInvitationEmail({
      email: invitation.email,
      token: newToken,
      coopId,
      coopName: invitation.coop.name,
      roleNames: invitation.roles.map((r) => r.role.name),
    });

    return updated;
  }

  /**
   * Replace the full set of roles attached to a pending invitation. Same
   * shape as `updateAdminRoles` but for not-yet-accepted invitees.
   */
  async updateInvitationRoles(coopId: string, invitationId: string, roleIds: string[]) {
    const invitation = await this.prisma.adminInvitation.findFirst({
      where: { id: invitationId, coopId, accepted: false },
    });
    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }

    if (!Array.isArray(roleIds) || roleIds.length === 0) {
      throw new BadRequestException('At least one role is required');
    }

    const validRoles = await this.prisma.coopRole.findMany({
      where: { id: { in: roleIds }, coopId },
      select: { id: true },
    });
    if (validRoles.length !== roleIds.length) {
      throw new NotFoundException('One or more roles not found in this cooperative');
    }

    await this.prisma.$transaction([
      this.prisma.adminInvitationRole.deleteMany({ where: { invitationId } }),
      this.prisma.adminInvitationRole.createMany({
        data: roleIds.map((roleId) => ({ invitationId, roleId })),
      }),
    ]);

    return this.prisma.adminInvitation.findUnique({
      where: { id: invitationId },
      include: {
        roles: { include: { role: { select: { id: true, name: true } } } },
      },
    });
  }

  async getInvitations(coopId: string) {
    return this.prisma.adminInvitation.findMany({
      where: { coopId, accepted: false },
      include: {
        roles: { include: { role: { select: { id: true, name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revokeInvitation(coopId: string, invitationId: string) {
    const invitation = await this.prisma.adminInvitation.findFirst({
      where: { id: invitationId, coopId, accepted: false },
    });
    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }

    await this.prisma.adminInvitation.delete({ where: { id: invitationId } });
    return { success: true };
  }

  // ==================== ACCEPT INVITATION ====================

  async getInvitationByToken(token: string) {
    const invitation = await this.prisma.adminInvitation.findUnique({
      where: { token },
      include: {
        coop: { select: { id: true, name: true, slug: true } },
        roles: { include: { role: { select: { id: true, name: true } } } },
      },
    });

    if (!invitation) {
      throw new NotFoundException('Invalid invitation');
    }
    if (invitation.accepted) {
      throw new BadRequestException('This invitation has already been accepted');
    }
    if (invitation.expiresAt < new Date()) {
      throw new BadRequestException('This invitation has expired');
    }

    return invitation;
  }

  // ==================== NOTIFICATION SETTINGS ====================

  async getNotificationSettings(coopId: string, userId: string) {
    const admin = await this.prisma.coopAdmin.findUnique({
      where: { userId_coopId: { userId, coopId } },
      include: { notificationSettings: true },
    });
    if (!admin) {
      throw new NotFoundException('Admin not found');
    }

    return (
      admin.notificationSettings ?? {
        frequency: 'IMMEDIATE',
        digestHour: 9,
        notifyOnNewShareholder: false,
        notifyOnSharePurchase: false,
        notifyOnShareSell: false,
        notifyOnPaymentReceived: false,
      }
    );
  }

  async updateNotificationSettings(
    coopId: string,
    userId: string,
    dto: {
      frequency?: 'IMMEDIATE' | 'DAILY' | 'WEEKLY';
      digestHour?: number;
      notifyOnNewShareholder?: boolean;
      notifyOnSharePurchase?: boolean;
      notifyOnShareSell?: boolean;
      notifyOnPaymentReceived?: boolean;
    },
  ) {
    const admin = await this.prisma.coopAdmin.findUnique({
      where: { userId_coopId: { userId, coopId } },
    });
    if (!admin) {
      throw new NotFoundException('Admin not found');
    }

    return this.prisma.coopAdminNotificationSettings.upsert({
      where: { coopAdminId: admin.id },
      create: {
        coopAdminId: admin.id,
        frequency: dto.frequency ?? 'IMMEDIATE',
        digestHour: dto.digestHour ?? 9,
        notifyOnNewShareholder: dto.notifyOnNewShareholder ?? false,
        notifyOnSharePurchase: dto.notifyOnSharePurchase ?? false,
        notifyOnShareSell: dto.notifyOnShareSell ?? false,
        notifyOnPaymentReceived: dto.notifyOnPaymentReceived ?? false,
      },
      update: {
        ...(dto.frequency !== undefined && { frequency: dto.frequency }),
        ...(dto.digestHour !== undefined && { digestHour: dto.digestHour }),
        ...(dto.notifyOnNewShareholder !== undefined && {
          notifyOnNewShareholder: dto.notifyOnNewShareholder,
        }),
        ...(dto.notifyOnSharePurchase !== undefined && {
          notifyOnSharePurchase: dto.notifyOnSharePurchase,
        }),
        ...(dto.notifyOnShareSell !== undefined && { notifyOnShareSell: dto.notifyOnShareSell }),
        ...(dto.notifyOnPaymentReceived !== undefined && {
          notifyOnPaymentReceived: dto.notifyOnPaymentReceived,
        }),
      },
    });
  }

  async acceptInvitation(token: string, userId: string) {
    const invitation = await this.getInvitationByToken(token);

    if (invitation.roles.length === 0) {
      // Pathological: invitation exists but has no roles. Refuse to
      // create an admin with empty permissions.
      throw new BadRequestException('Invitation has no roles attached');
    }

    // Create CoopAdmin entry with every invitation role copied into the
    // CoopAdminRole join table.
    await this.prisma.coopAdmin.create({
      data: {
        userId,
        coopId: invitation.coopId,
        roles: {
          create: invitation.roles.map((r) => ({ roleId: r.role.id })),
        },
      },
    });

    // Mark invitation as accepted
    await this.prisma.adminInvitation.update({
      where: { id: invitation.id },
      data: { accepted: true },
    });

    // Upgrade user role if they're a regular shareholder
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (user && user.role === 'SHAREHOLDER') {
      await this.prisma.user.update({
        where: { id: userId },
        data: { role: 'COOP_ADMIN' },
      });
    }

    return {
      coopId: invitation.coopId,
      coopName: invitation.coop.name,
      coopSlug: invitation.coop.slug,
      roleNames: invitation.roles.map((r) => r.role.name),
    };
  }

  // ==================== EDIT TEAM MEMBER USER ====================

  /**
   * Update name and preferredLanguage on the User row of a team member.
   *
   * The login email is not a coop field. It is the global identity of the
   * account: magic link, password reset and login all key on it, and the
   * same account can belong to other coops. A coop admin who could rewrite
   * it could send themselves a magic link and sign in as that person. So a
   * coop admin gets 403 for a different email; resending the current value
   * (any case) is a no-op.
   *
   * A system admin may request a change, but it only becomes the login email
   * after the new address proves itself through the existing verify-email
   * link (see AuthService.verifyEmail). Until then `email` stays as it is and
   * the old address gets a notice. Every change here is written to the audit
   * log with the acting user.
   *
   * A coop admin may not edit a system admin's account at all.
   */
  async updateAdminUser(
    coopId: string,
    adminId: string,
    dto: { name?: string | null; preferredLanguage?: string; email?: string },
    actor: { id: string; role: string },
  ) {
    const admin = await this.prisma.coopAdmin.findFirst({
      where: { id: adminId, coopId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            role: true,
            name: true,
            preferredLanguage: true,
            pendingEmail: true,
            emailVerifyExpires: true,
          },
        },
      },
    });
    if (!admin) {
      throw new NotFoundException('Admin not found');
    }

    const actorIsSystemAdmin = actor.role === 'SYSTEM_ADMIN';
    if (admin.user.role === 'SYSTEM_ADMIN' && !actorIsSystemAdmin) {
      throw new ForbiddenException('Only a system admin can change a system admin account');
    }

    const data: Prisma.UserUpdateInput = {};
    const changes: { field: string; oldValue: unknown; newValue: unknown }[] = [];
    if (dto.name !== undefined && dto.name !== admin.user.name) {
      data.name = dto.name;
      changes.push({ field: 'name', oldValue: admin.user.name, newValue: dto.name });
    }
    if (
      dto.preferredLanguage !== undefined &&
      dto.preferredLanguage !== admin.user.preferredLanguage
    ) {
      data.preferredLanguage = dto.preferredLanguage;
      changes.push({
        field: 'preferredLanguage',
        oldValue: admin.user.preferredLanguage,
        newValue: dto.preferredLanguage,
      });
    }

    let pending: { email: string; token: string } | undefined;
    const currentPending = activePendingEmail(admin.user);
    if (dto.email !== undefined) {
      const newEmail = dto.email.toLowerCase().trim();
      if (newEmail === admin.user.email.toLowerCase()) {
        // A system admin cancels a pending change by submitting the current
        // address. For anyone else this stays a no-op.
        if (actorIsSystemAdmin && admin.user.pendingEmail) {
          Object.assign(data, CLEAR_PENDING_EMAIL);
          if (currentPending) {
            changes.push({ field: 'pendingEmail', oldValue: currentPending, newValue: null });
          }
        }
      } else {
        if (!actorIsSystemAdmin) {
          throw new ForbiddenException("A coop admin cannot change a team member's login email");
        }
        const inUse = await this.prisma.user.findUnique({ where: { email: newEmail } });
        if (inUse) {
          throw new ConflictException('Another user already uses this email');
        }
        const token = crypto.randomBytes(32).toString('hex');
        pending = { email: newEmail, token };
        data.pendingEmail = newEmail;
        data.emailVerifyToken = hashToken(token);
        data.emailVerifyExpires = new Date(Date.now() + EMAIL_CHANGE_TTL_MS);
        changes.push({ field: 'pendingEmail', oldValue: currentPending, newValue: newEmail });
      }
    }

    const select = {
      id: true,
      name: true,
      email: true,
      pendingEmail: true,
      preferredLanguage: true,
      emailVerified: true,
    } as const;

    if (Object.keys(data).length === 0) {
      return this.prisma.user.findUnique({ where: { id: admin.user.id }, select });
    }

    // The old address must accept its notice before any token exists, so
    // nothing is claimable that the old owner was not told about. A failed
    // notice writes nothing.
    const lang = (data.preferredLanguage as string | undefined) ?? admin.user.preferredLanguage;
    if (pending) {
      try {
        await this.authEmail.sendLoginEmailChangeNotice(admin.user.email, pending.email, lang);
      } catch {
        throw new InternalServerErrorException(
          'The login email change was not started because the current address could not be notified. Try again.',
        );
      }
    }

    const updated = await this.prisma.user.update({
      where: { id: admin.user.id },
      data,
      select,
    });

    await this.auditService.log({
      coopId,
      entity: 'User',
      entityId: admin.user.id,
      action: 'UPDATE',
      changes,
      actorId: actor.id,
    });

    if (pending) {
      try {
        await this.authEmail.sendVerificationEmail(pending.email, pending.token, lang);
      } catch {
        // Drop exactly this request; a newer request or a cancel that landed
        // meanwhile keeps its own state.
        const dropped = await this.prisma.user.updateMany({
          where: {
            id: admin.user.id,
            pendingEmail: pending.email,
            emailVerifyToken: hashToken(pending.token),
          },
          data: CLEAR_PENDING_EMAIL,
        });
        if (dropped.count > 0) {
          await this.auditService.log({
            coopId,
            entity: 'User',
            entityId: admin.user.id,
            action: 'UPDATE',
            changes: [{ field: 'pendingEmail', oldValue: pending.email, newValue: null }],
            actorId: actor.id,
          });
        }
        throw new InternalServerErrorException(
          'The login email change was not started because a mail could not be sent. Try again.',
        );
      }
    }

    return updated;
  }
}
