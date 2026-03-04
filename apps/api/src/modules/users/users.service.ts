import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService, private auditService: AuditService) {}

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        preferredLanguage: true,
        emailVerified: true,
        createdAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });
  }

  async updatePreferences(userId: string, data: { name?: string; preferredLanguage?: string }) {
    const old = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, preferredLanguage: true },
    });

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        preferredLanguage: true,
      },
    });

    if (old) {
      const changes = this.auditService.diff(old as Record<string, unknown>, data);
      if (changes.length > 0) {
        await this.auditService.log({
          entity: 'User',
          entityId: userId,
          action: 'UPDATE',
          changes,
          actorId: userId,
        });
      }
    }

    return updated;
  }
}
