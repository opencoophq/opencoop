// documents.service transitively imports @react-pdf/renderer (ESM-only) — mock the whole module
// This MUST appear before any imports that would trigger the chain
jest.mock('../documents/documents.service', () => ({
  DocumentsService: class DocumentsServiceMock {},
}));

import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { EmailService } from '../email/email.service';
import { CoopsService } from '../coops/coops.service';
import { AuditService } from '../audit/audit.service';

// ============================================================================
// Shared fixtures
// ============================================================================

const SUCCESS_MESSAGE = { message: 'If an account exists, a login link has been sent' };

const janUser = {
  id: 'jan-user-id',
  email: 'jan@x.com',
  name: 'Jan Peeters',
  role: 'SHAREHOLDER',
  preferredLanguage: 'nl',
  emailVerified: new Date(),
  mfaEnabled: false,
  coopAdminOf: [],
};

// Shareholder linked to jan — userId set, email null (post-household-link state)
const janShareholderLinked = {
  id: 'jan-sh-1',
  coopId: 'coop-1',
  userId: janUser.id,
  email: null,
  firstName: 'Jan',
  lastName: 'Peeters',
};

// Second household shareholder, also linked to jan — userId set, email null
const marieShareholderLinked = {
  id: 'marie-sh-1',
  coopId: 'coop-1',
  userId: janUser.id,
  email: null,
  firstName: 'Marie',
  lastName: 'Peeters',
};

// True orphan shareholder: no userId, but has own email
const orphanShareholder = {
  id: 'orphan-sh-1',
  coopId: 'coop-2',
  userId: null,
  email: 'orphan@x.com',
  firstName: 'Orphan',
  lastName: 'User',
};

// ============================================================================
// Test suite
// ============================================================================

describe('AuthService — requestMagicLink with household shareholders', () => {
  let service: AuthService;
  let prisma: any;
  let emailService: any;

  // Track how many times user.create is called, and with what args
  let userCreateMock: jest.Mock;
  let shareholderFindFirstMock: jest.Mock;

  beforeEach(async () => {
    userCreateMock = jest.fn();
    shareholderFindFirstMock = jest.fn();

    prisma = {
      user: {
        findUnique: jest.fn(),
        create: userCreateMock,
        count: jest.fn().mockResolvedValue(0), // used in some tests to count users
      },
      shareholder: {
        findFirst: shareholderFindFirstMock,
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      magicLinkToken: {
        count: jest.fn().mockResolvedValue(0), // 0 recent tokens → no rate limit
        create: jest.fn().mockResolvedValue({ id: 'tok-1', token: 'abc123' }),
      },
      channel: {
        findFirst: jest.fn().mockResolvedValue(null), // no coop branding
      },
    };

    emailService = {
      sendPlatformEmail: jest.fn().mockResolvedValue(undefined),
    };

    const jwtService = { sign: jest.fn().mockReturnValue('jwt-token') };
    const usersService = {};
    const coopsService = {};
    const auditService = { log: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: UsersService, useValue: usersService },
        { provide: JwtService, useValue: jwtService },
        { provide: EmailService, useValue: emailService },
        { provide: CoopsService, useValue: coopsService },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  // --------------------------------------------------------------------------
  // Test 1: shared-inbox User with multiple linked shareholders gets ONE email
  // --------------------------------------------------------------------------

  it('sends exactly one magic link to a User who has multiple household shareholders', async () => {
    // User exists with jan@x.com; two shareholders linked (userId=jan, email=null each)
    prisma.user.findUnique.mockResolvedValue(janUser);
    // shareholder.findFirst should NOT be called (user found directly)
    shareholderFindFirstMock.mockResolvedValue(null);

    const result = await service.requestMagicLink({ email: 'jan@x.com' });

    expect(result).toEqual(SUCCESS_MESSAGE);

    // Exactly one magic link email sent
    expect(emailService.sendPlatformEmail).toHaveBeenCalledTimes(1);
    expect(emailService.sendPlatformEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'jan@x.com' }),
    );

    // No user was auto-created (user was found directly)
    expect(userCreateMock).not.toHaveBeenCalled();

    // Orphan-shareholder fallback was NOT consulted (findFirst not needed when user exists)
    expect(shareholderFindFirstMock).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // Test 2: linked shareholder (userId=set, email=null) MUST NOT trigger auto-creation
  // --------------------------------------------------------------------------

  it('does not auto-create a User for a linked shareholder (userId set, email null)', async () => {
    // No user exists for this email
    prisma.user.findUnique.mockResolvedValue(null);

    // The orphan-lookup query looks for shareholders where email matches AND userId=null.
    // A linked shareholder has email=null, so a string equality match is impossible.
    // We simulate this correctly: return null (no orphan found for this email).
    shareholderFindFirstMock.mockResolvedValue(null);

    const result = await service.requestMagicLink({ email: 'marie@nonexistent.com' });

    // Returns the generic success message (silent — no email enumeration)
    expect(result).toEqual(SUCCESS_MESSAGE);

    // No user was created
    expect(userCreateMock).not.toHaveBeenCalled();

    // No email was sent (no user to send to)
    expect(emailService.sendPlatformEmail).not.toHaveBeenCalled();

    // The orphan-lookup WAS called with the right filter — userId: null AND email match
    expect(shareholderFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: null,
          email: expect.objectContaining({ equals: 'marie@nonexistent.com' }),
        }),
      }),
    );
  });

  // --------------------------------------------------------------------------
  // Test 3: true orphan (userId=null, email set) STILL triggers auto-creation
  // --------------------------------------------------------------------------

  it('orphan fallback still works for a true orphan shareholder (userId=null, email set)', async () => {
    // No User account yet for orphan@x.com
    prisma.user.findUnique.mockResolvedValue(null);

    // The orphan-lookup finds a real orphan: userId=null, email='orphan@x.com'
    shareholderFindFirstMock.mockResolvedValue(orphanShareholder);

    // Simulate the user.create returning the new user
    const createdUser = {
      id: 'new-orphan-user-id',
      email: 'orphan@x.com',
      name: 'Orphan User',
      role: 'SHAREHOLDER',
      preferredLanguage: 'nl',
      emailVerified: new Date(),
      mfaEnabled: false,
      coopAdminOf: [],
    };
    userCreateMock.mockResolvedValue(createdUser);

    const result = await service.requestMagicLink({ email: 'orphan@x.com' });

    // Returns the generic success message
    expect(result).toEqual(SUCCESS_MESSAGE);

    // A new User was created from the orphan shareholder data
    expect(userCreateMock).toHaveBeenCalledTimes(1);
    expect(userCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'orphan@x.com',
          name: 'Orphan User',
          role: 'SHAREHOLDER',
        }),
      }),
    );

    // Email was sent
    expect(emailService.sendPlatformEmail).toHaveBeenCalledTimes(1);
    expect(emailService.sendPlatformEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'orphan@x.com' }),
    );

    // The orphan shareholder was linked (updateMany called)
    expect(prisma.shareholder.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: null,
          email: expect.objectContaining({ equals: 'orphan@x.com' }),
        }),
        data: expect.objectContaining({ userId: createdUser.id }),
      }),
    );
  });

  // --------------------------------------------------------------------------
  // Test 4: orphan lookup filter is correct — userId must be null
  // --------------------------------------------------------------------------

  it('orphan lookup always filters by userId: null, preventing linked shareholders from triggering auto-creation', async () => {
    // No user found by email
    prisma.user.findUnique.mockResolvedValue(null);
    // No orphan found (because linked shareholders have email=null, not the queried email)
    shareholderFindFirstMock.mockResolvedValue(null);

    await service.requestMagicLink({ email: 'anyone@x.com' });

    // The query MUST include both userId: null and email filter
    const call = shareholderFindFirstMock.mock.calls[0][0];
    expect(call.where).toMatchObject({
      userId: null,
      email: expect.objectContaining({ equals: 'anyone@x.com' }),
    });

    // No spurious user creation
    expect(userCreateMock).not.toHaveBeenCalled();
  });
});
