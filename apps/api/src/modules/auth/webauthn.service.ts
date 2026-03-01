import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
} from '@simplewebauthn/server/script/types';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from './redis.service';

function bufferToBase64url(buf: Buffer | Uint8Array): string {
  return Buffer.from(buf).toString('base64url');
}

@Injectable()
export class WebAuthnService {
  private rpName: string;
  private rpId: string;
  private origin: string;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private redisService: RedisService,
  ) {
    this.rpName = this.configService.get('WEBAUTHN_RP_NAME', 'OpenCoop');
    this.rpId = this.configService.get('WEBAUTHN_RP_ID', 'localhost');
    this.origin = this.configService.get('WEBAUTHN_ORIGIN', 'http://localhost:3002');
  }

  async generateRegistrationOptions(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { webAuthnCredentials: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const excludeCredentials = user.webAuthnCredentials.map((cred) => ({
      id: bufferToBase64url(cred.credentialId),
      transports: cred.transports as AuthenticatorTransportFuture[],
    }));

    const options = await generateRegistrationOptions({
      rpName: this.rpName,
      rpID: this.rpId,
      userName: user.email,
      userDisplayName: user.name || user.email,
      excludeCredentials,
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
    });

    await this.redisService.setChallenge(`webauthn:reg:${userId}`, options.challenge, 300);
    return options;
  }

  async verifyRegistration(userId: string, response: RegistrationResponseJSON, friendlyName?: string) {
    const expectedChallenge = await this.redisService.getChallenge(`webauthn:reg:${userId}`);
    if (!expectedChallenge) {
      throw new BadRequestException('Registration challenge expired');
    }

    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: this.origin,
      expectedRPID: this.rpId,
    });

    if (!verification.verified || !verification.registrationInfo) {
      throw new BadRequestException('Registration verification failed');
    }

    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

    // credential.id is a Base64URL string in v13
    await this.prisma.webAuthnCredential.create({
      data: {
        userId,
        credentialId: Buffer.from(credential.id, 'base64url'),
        publicKey: Buffer.from(credential.publicKey),
        counter: BigInt(credential.counter),
        credentialDeviceType,
        credentialBackedUp,
        transports: (credential.transports ?? []) as string[],
        friendlyName,
      },
    });

    return { verified: true };
  }

  async generateAuthenticationOptions(email?: string) {
    let allowCredentials: { id: string; transports?: AuthenticatorTransportFuture[] }[] | undefined;

    if (email) {
      const user = await this.prisma.user.findUnique({
        where: { email: email.toLowerCase() },
        include: { webAuthnCredentials: true },
      });
      if (user && user.webAuthnCredentials.length > 0) {
        allowCredentials = user.webAuthnCredentials.map((cred) => ({
          id: bufferToBase64url(cred.credentialId),
          transports: cred.transports as AuthenticatorTransportFuture[],
        }));
      }
    }

    const options = await generateAuthenticationOptions({
      rpID: this.rpId,
      userVerification: 'preferred',
      allowCredentials,
    });

    // Store challenge keyed by its value for lookup during verification
    await this.redisService.setChallenge(`webauthn:auth:${options.challenge}`, options.challenge, 300);
    return options;
  }

  async verifyAuthentication(response: AuthenticationResponseJSON) {
    // Find the credential by its base64url-encoded ID
    const credentialIdBuf = Buffer.from(response.id, 'base64url');
    const credential = await this.prisma.webAuthnCredential.findUnique({
      where: { credentialId: credentialIdBuf },
      include: {
        user: {
          include: {
            coopAdminOf: { select: { coopId: true } },
          },
        },
      },
    });

    if (!credential) {
      throw new BadRequestException('Unknown credential');
    }

    // Extract challenge from clientDataJSON to look up stored challenge
    const clientDataStr = Buffer.from(response.response.clientDataJSON, 'base64url').toString('utf-8');
    const challengeMatch = clientDataStr.match(/"challenge"\s*:\s*"([^"]+)"/);
    const challenge = challengeMatch?.[1] ?? '';
    const expectedChallenge = await this.redisService.getChallenge(`webauthn:auth:${challenge}`);

    if (!expectedChallenge) {
      throw new BadRequestException('Authentication challenge expired');
    }

    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: this.origin,
      expectedRPID: this.rpId,
      credential: {
        id: bufferToBase64url(credential.credentialId),
        publicKey: credential.publicKey,
        counter: Number(credential.counter),
        transports: credential.transports as AuthenticatorTransportFuture[],
      },
    });

    if (!verification.verified) {
      throw new BadRequestException('Authentication verification failed');
    }

    // Update counter and lastUsedAt
    await this.prisma.webAuthnCredential.update({
      where: { id: credential.id },
      data: {
        counter: BigInt(verification.authenticationInfo.newCounter),
        lastUsedAt: new Date(),
      },
    });

    return credential.user;
  }

  async listCredentials(userId: string) {
    return this.prisma.webAuthnCredential.findMany({
      where: { userId },
      select: {
        id: true,
        friendlyName: true,
        credentialDeviceType: true,
        credentialBackedUp: true,
        createdAt: true,
        lastUsedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async deleteCredential(userId: string, credentialId: string) {
    const credential = await this.prisma.webAuthnCredential.findFirst({
      where: { id: credentialId, userId },
    });
    if (!credential) {
      throw new NotFoundException('Credential not found');
    }
    await this.prisma.webAuthnCredential.delete({ where: { id: credentialId } });
    return { deleted: true };
  }

  async renameCredential(userId: string, credentialId: string, friendlyName: string) {
    const credential = await this.prisma.webAuthnCredential.findFirst({
      where: { id: credentialId, userId },
    });
    if (!credential) {
      throw new NotFoundException('Credential not found');
    }
    await this.prisma.webAuthnCredential.update({
      where: { id: credentialId },
      data: { friendlyName },
    });
    return { updated: true };
  }
}
