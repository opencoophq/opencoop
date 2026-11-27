jest.mock('../documents/documents.service', () => ({
  DocumentsService: class DocumentsServiceMock {},
}));

jest.mock('bcrypt', () => ({
  compare: jest.fn(),
  hash: jest.fn(async () => 'hashed-new-password'),
}));

import { BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';

function authService() {
  const prisma = {
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const auditService = { log: jest.fn().mockResolvedValue(undefined) };
  const tokenService = {
    revokeAllSessions: jest.fn().mockResolvedValue(undefined),
    issueJwtForUser: jest
      .fn()
      .mockResolvedValue({ accessToken: 'new-access', refreshToken: 'new-refresh' }),
  };
  const service = new AuthService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    auditService as never,
    tokenService as never,
  );
  return { service, prisma, tokenService };
}

describe('password changes revoke every session', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('revokes every session after a password change and opens a new one for the caller', async () => {
    const { service, prisma, tokenService } = authService();
    const user = { id: 'user-1', passwordHash: 'stored', coopAdminOf: [] };
    prisma.user.findUnique.mockResolvedValue(user);
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);

    const result = await service.changePassword('user-1', 'old-password', 'new-password-1');

    expect(tokenService.revokeAllSessions).toHaveBeenCalledWith('user-1');
    expect(tokenService.issueJwtForUser).toHaveBeenCalledWith(user, true);
    // The new session is issued after the revocation, so it survives it.
    expect(tokenService.revokeAllSessions.mock.invocationCallOrder[0]).toBeLessThan(
      tokenService.issueJwtForUser.mock.invocationCallOrder[0],
    );
    expect(result).toEqual(
      expect.objectContaining({ accessToken: 'new-access', refreshToken: 'new-refresh' }),
    );
  });

  it('does not revoke sessions when the current password is wrong', async () => {
    const { service, prisma, tokenService } = authService();
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', passwordHash: 'stored' });
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);

    await expect(
      service.changePassword('user-1', 'wrong', 'new-password-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tokenService.revokeAllSessions).not.toHaveBeenCalled();
  });

  it('revokes refresh tokens after a password reset', async () => {
    const { service, prisma, tokenService } = authService();
    prisma.user.findFirst.mockResolvedValue({ id: 'user-2' });

    await service.resetPassword({ token: 'reset-token', password: 'new-password-1' });

    expect(tokenService.revokeAllSessions).toHaveBeenCalledWith('user-2');
  });

  it('does not revoke sessions when the reset token is invalid', async () => {
    const { service, prisma, tokenService } = authService();
    prisma.user.findFirst.mockResolvedValue(null);

    await expect(
      service.resetPassword({ token: 'nope', password: 'new-password-1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tokenService.revokeAllSessions).not.toHaveBeenCalled();
  });

  it('logout revokes every refresh token for the user', async () => {
    const tokenService = { revokeAllSessions: jest.fn().mockResolvedValue(undefined) };
    const controller = new AuthController(
      {} as never,
      tokenService as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(controller.logout({ id: 'user-3' } as never)).resolves.toEqual({
      message: 'Logged out successfully',
    });
    expect(tokenService.revokeAllSessions).toHaveBeenCalledWith('user-3');
  });
});
