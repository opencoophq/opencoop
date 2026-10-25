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
  const tokenService = { revokeRefreshTokens: jest.fn().mockResolvedValue(undefined) };
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

  it('revokes refresh tokens after a successful password change', async () => {
    const { service, prisma, tokenService } = authService();
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', passwordHash: 'stored' });
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);

    await service.changePassword('user-1', 'old-password', 'new-password-1');

    expect(tokenService.revokeRefreshTokens).toHaveBeenCalledWith('user-1');
  });

  it('does not revoke sessions when the current password is wrong', async () => {
    const { service, prisma, tokenService } = authService();
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', passwordHash: 'stored' });
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);

    await expect(service.changePassword('user-1', 'wrong', 'new-password-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(tokenService.revokeRefreshTokens).not.toHaveBeenCalled();
  });

  it('revokes refresh tokens after a password reset', async () => {
    const { service, prisma, tokenService } = authService();
    prisma.user.findFirst.mockResolvedValue({ id: 'user-2' });

    await service.resetPassword({ token: 'reset-token', password: 'new-password-1' });

    expect(tokenService.revokeRefreshTokens).toHaveBeenCalledWith('user-2');
  });

  it('does not revoke sessions when the reset token is invalid', async () => {
    const { service, prisma, tokenService } = authService();
    prisma.user.findFirst.mockResolvedValue(null);

    await expect(service.resetPassword({ token: 'nope', password: 'new-password-1' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(tokenService.revokeRefreshTokens).not.toHaveBeenCalled();
  });

  it('logout revokes every refresh token for the user', async () => {
    const tokenService = { revokeRefreshTokens: jest.fn().mockResolvedValue(undefined) };
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
    expect(tokenService.revokeRefreshTokens).toHaveBeenCalledWith('user-3');
  });
});
