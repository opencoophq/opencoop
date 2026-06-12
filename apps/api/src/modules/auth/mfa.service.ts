import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import * as OTPAuth from 'otpauth';
import * as QRCode from 'qrcode';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { encryptMfaSecret, decryptMfaSecret, generateRecoveryCodes } from '../../common/crypto';

/**
 * MFA / TOTP management: setup, enable, disable, recovery-code regeneration,
 * and status. Extracted from AuthService to keep that file focused on auth
 * flow logic. Note: `mfaVerify` deliberately stays in AuthService because it
 * is login-coupled (issues a JWT via `issueJwtForUser`).
 */
@Injectable()
export class MfaService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
  ) {}

  async mfaSetup(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');
    if (user.mfaEnabled) throw new BadRequestException('MFA is already enabled');
    if (!user.passwordHash) throw new BadRequestException('Set a password before enabling MFA');

    const secret = new OTPAuth.Secret({ size: 20 });
    const totp = new OTPAuth.TOTP({
      issuer: 'OpenCoop',
      label: user.email,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret,
    });

    const otpauthUri = totp.toString();
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUri);

    // Store encrypted secret temporarily (not yet enabled)
    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaSecret: encryptMfaSecret(secret.base32) },
    });

    return { qrCodeDataUrl, secret: secret.base32, otpauthUri };
  }

  async mfaEnable(userId: string, code: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');
    if (user.mfaEnabled) throw new BadRequestException('MFA is already enabled');
    if (!user.mfaSecret) throw new BadRequestException('Call /auth/mfa/setup first');

    const secret = decryptMfaSecret(user.mfaSecret);
    const totp = new OTPAuth.TOTP({
      issuer: 'OpenCoop',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secret),
    });

    const delta = totp.validate({ token: code, window: 1 });
    if (delta === null) {
      throw new BadRequestException('Invalid verification code');
    }

    const { plain, hashed } = generateRecoveryCodes();

    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaEnabled: true, mfaRecoveryCodes: hashed },
    });

    await this.auditService.log({
      entity: 'User',
      entityId: userId,
      action: 'UPDATE',
      changes: [{ field: 'mfaEnabled', oldValue: false, newValue: true }],
      actorId: userId,
    });

    return { recoveryCodes: plain };
  }

  async mfaDisable(userId: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');
    if (!user.mfaEnabled) throw new BadRequestException('MFA is not enabled');

    if (user.passwordHash) {
      const isValid = await bcrypt.compare(password, user.passwordHash);
      if (!isValid) throw new BadRequestException('Invalid password');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaEnabled: false, mfaSecret: null, mfaRecoveryCodes: [] },
    });

    await this.auditService.log({
      entity: 'User',
      entityId: userId,
      action: 'UPDATE',
      changes: [{ field: 'mfaEnabled', oldValue: true, newValue: false }],
      actorId: userId,
    });

    return { message: 'MFA disabled' };
  }

  async mfaRegenerateRecoveryCodes(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');
    if (!user.mfaEnabled) throw new BadRequestException('MFA is not enabled');

    const { plain, hashed } = generateRecoveryCodes();
    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaRecoveryCodes: hashed },
    });

    return { recoveryCodes: plain };
  }

  async mfaStatus(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { mfaEnabled: true },
    });
    if (!user) throw new UnauthorizedException('User not found');
    return { mfaEnabled: user.mfaEnabled };
  }
}
