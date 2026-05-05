import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import * as crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { InviteAdminDto } from './dto/invite-admin.dto';
import { CoopPermissions } from '@opencoop/shared';

@Injectable()
export class CoopAdminsService {
  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
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
      'Admin': 1,
      'Manager': 2,
      'Viewer': 3,
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
      throw new BadRequestException('Reassign all administrators using this role before deleting it');
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

  async updateAdminPermissionOverrides(coopId: string, adminId: string, overrides: Record<string, boolean> | null) {
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
      throw new BadRequestException('Cannot remove the last administrator with management permissions');
    }

    // Delete CoopAdmin entry (cascades to coop_admin_roles)
    await this.prisma.coopAdmin.delete({ where: { id: adminId } });

    // Check if user still admins any other coop
    const remainingAdminEntries = await this.prisma.coopAdmin.count({
      where: { userId: admin.userId },
    });
    // If no more coop admin entries, downgrade user role to SHAREHOLDER
    if (remainingAdminEntries === 0) {
      await this.prisma.user.update({
        where: { id: admin.userId },
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

    const role = await this.prisma.coopRole.findFirst({
      where: { id: dto.roleId, coopId },
    });
    if (!role) {
      throw new NotFoundException('Role not found');
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

    // Check for existing pending invitation
    const existingInvitation = await this.prisma.adminInvitation.findUnique({
      where: { coopId_email: { coopId, email: dto.email.toLowerCase() } },
    });
    if (existingInvitation && !existingInvitation.accepted) {
      // Delete old invitation and create a new one
      await this.prisma.adminInvitation.delete({ where: { id: existingInvitation.id } });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const invitation = await this.prisma.adminInvitation.create({
      data: {
        coopId,
        email: dto.email.toLowerCase(),
        roleId: dto.roleId,
        token,
        expiresAt,
      },
      include: {
        role: { select: { name: true } },
      },
    });

    await this.sendInvitationEmail({
      email: dto.email,
      token,
      coopName: coop.name,
      roleName: role.name,
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
    coopName: string;
    roleName: string;
  }): Promise<void> {
    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'https://opencoop.be';
    const inviteUrl = `${appUrl}/invite/${args.token}`;

    await this.emailService
      .sendPlatformEmail({
        to: args.email,
        subject: `You've been invited to manage ${args.coopName} on OpenCoop`,
        html: `
        <h2>You've been invited to ${args.coopName}</h2>
        <p>You've been invited as <strong>${args.roleName}</strong> for the cooperative <strong>${args.coopName}</strong> on OpenCoop.</p>
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
        role: { select: { name: true } },
      },
    });
    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }
    if (invitation.expiresAt < new Date()) {
      // An expired invite is technically still in the table (we don't
      // GC) — resending should resurrect it. Allow it; the rotation
      // below will set a fresh expiry and the invitee will get a
      // working email.
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
      coopName: invitation.coop.name,
      roleName: invitation.role.name,
    });

    return updated;
  }

  async getInvitations(coopId: string) {
    return this.prisma.adminInvitation.findMany({
      where: { coopId, accepted: false },
      include: {
        role: { select: { id: true, name: true } },
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
        role: { select: { id: true, name: true } },
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

    return admin.notificationSettings ?? {
      frequency: 'IMMEDIATE',
      digestHour: 9,
      notifyOnNewShareholder: false,
      notifyOnSharePurchase: false,
      notifyOnShareSell: false,
      notifyOnPaymentReceived: false,
    };
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
        ...(dto.notifyOnNewShareholder !== undefined && { notifyOnNewShareholder: dto.notifyOnNewShareholder }),
        ...(dto.notifyOnSharePurchase !== undefined && { notifyOnSharePurchase: dto.notifyOnSharePurchase }),
        ...(dto.notifyOnShareSell !== undefined && { notifyOnShareSell: dto.notifyOnShareSell }),
        ...(dto.notifyOnPaymentReceived !== undefined && { notifyOnPaymentReceived: dto.notifyOnPaymentReceived }),
      },
    });
  }

  async acceptInvitation(token: string, userId: string) {
    const invitation = await this.getInvitationByToken(token);

    // Create CoopAdmin entry with the invitation's role attached via the
    // join table. The admin can later be granted additional roles from
    // the team UI.
    await this.prisma.coopAdmin.create({
      data: {
        userId,
        coopId: invitation.coopId,
        roles: {
          create: { roleId: invitation.roleId },
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
      roleName: invitation.role.name,
    };
  }
}
