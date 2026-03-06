import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import * as crypto from 'crypto';
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
    return this.prisma.coopRole.findMany({
      where: { coopId },
      include: { _count: { select: { coopAdmins: true } } },
      orderBy: { createdAt: 'asc' },
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
      include: { _count: { select: { coopAdmins: true } } },
    });
    if (!role) {
      throw new NotFoundException('Role not found');
    }
    if (role.isDefault) {
      throw new BadRequestException('Cannot delete a default role');
    }
    if (role._count.coopAdmins > 0) {
      throw new BadRequestException('Reassign all administrators using this role before deleting it');
    }

    return this.prisma.coopRole.delete({ where: { id: roleId } });
  }

  // ==================== ADMINS ====================

  async getAdmins(coopId: string) {
    return this.prisma.coopAdmin.findMany({
      where: { coopId },
      include: {
        user: {
          select: { id: true, email: true, name: true, role: true },
        },
        role: {
          select: { id: true, name: true, permissions: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async updateAdminRole(coopId: string, adminId: string, roleId: string) {
    const admin = await this.prisma.coopAdmin.findFirst({
      where: { id: adminId, coopId },
    });
    if (!admin) {
      throw new NotFoundException('Admin not found');
    }

    const role = await this.prisma.coopRole.findFirst({
      where: { id: roleId, coopId },
    });
    if (!role) {
      throw new NotFoundException('Role not found');
    }

    return this.prisma.coopAdmin.update({
      where: { id: adminId },
      data: { roleId },
      include: {
        user: { select: { id: true, email: true, name: true, role: true } },
        role: { select: { id: true, name: true, permissions: true } },
      },
    });
  }

  async removeAdmin(coopId: string, adminId: string) {
    const admin = await this.prisma.coopAdmin.findFirst({
      where: { id: adminId, coopId },
      include: { role: true },
    });
    if (!admin) {
      throw new NotFoundException('Admin not found');
    }

    // Check if this is the last admin with canManageAdmins permission
    const adminsWithManagePermission = await this.prisma.coopAdmin.findMany({
      where: { coopId },
      include: { role: true },
    });
    const managingAdmins = adminsWithManagePermission.filter(
      (a) => (a.role.permissions as any)?.canManageAdmins === true,
    );
    if (managingAdmins.length <= 1 && (admin.role.permissions as any)?.canManageAdmins === true) {
      throw new BadRequestException('Cannot remove the last administrator with management permissions');
    }

    // Delete CoopAdmin entry
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

    // Send invitation email
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'https://opencoop.be';
    const inviteUrl = `${appUrl}/invite/${token}`;

    await this.emailService.sendPlatformEmail({
      to: dto.email,
      subject: `You've been invited to manage ${coop.name} on OpenCoop`,
      html: `
        <h2>You've been invited to ${coop.name}</h2>
        <p>You've been invited as <strong>${role.name}</strong> for the cooperative <strong>${coop.name}</strong> on OpenCoop.</p>
        <p><a href="${inviteUrl}" style="display:inline-block;padding:12px 24px;background-color:#1e40af;color:#fff;text-decoration:none;border-radius:6px;">Accept Invitation</a></p>
        <p>This invitation expires in 7 days.</p>
        <p>If you didn't expect this invitation, you can safely ignore this email.</p>
      `,
    }).catch((err) => {
      console.error('Failed to send admin invitation email:', err.message);
    });

    return invitation;
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

  async acceptInvitation(token: string, userId: string) {
    const invitation = await this.getInvitationByToken(token);

    // Create CoopAdmin entry
    await this.prisma.coopAdmin.create({
      data: {
        userId,
        coopId: invitation.coopId,
        roleId: invitation.roleId,
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
