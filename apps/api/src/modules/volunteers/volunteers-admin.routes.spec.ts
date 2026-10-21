jest.mock('../coops/coops.service', () => ({
  CoopsService: class CoopsService {},
}));

import 'reflect-metadata';
import { CanActivate, ExecutionContext, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CoopGuard } from '../../common/guards/coop.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { VolunteersAdminController } from './volunteers-admin.controller';
import { VolunteersService } from './volunteers.service';

interface SessionUser {
  id: string;
  email: string;
  role: string;
  coopIds?: string[];
  coopPermissions?: Record<string, Record<string, boolean>>;
}

const session: { user: SessionUser | null } = { user: null };

class TestJwtGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    request.user = session.user;
    return session.user !== null;
  }
}

class AllowSubscriptionGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}

describe('VolunteersAdminController routes', () => {
  let app: INestApplication;
  let baseUrl: string;
  const volunteers = {
    adminGet: jest.fn(),
    adminUpdate: jest.fn(),
    adminInterestOptions: jest.fn(),
    adminUpdateInterests: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [VolunteersAdminController],
      providers: [
        RolesGuard,
        CoopGuard,
        PermissionGuard,
        { provide: VolunteersService, useValue: volunteers },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(TestJwtGuard)
      .overrideGuard(SubscriptionGuard)
      .useClass(AllowSubscriptionGuard)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    session.user = {
      id: 'user-1',
      email: 'admin@example.be',
      role: 'COOP_ADMIN',
      coopIds: ['coop-1'],
      coopPermissions: { 'coop-1': { canViewVolunteers: true } },
    };
    volunteers.adminGet.mockResolvedValue({ id: 'v1', name: 'An Peeters', status: 'ACTIVE' });
    volunteers.adminUpdate.mockResolvedValue({ id: 'v1', status: 'WITHDRAWN' });
    volunteers.adminInterestOptions.mockResolvedValue({
      source: 'configured',
      options: [{ tag: 'board', active: true }],
    });
    volunteers.adminUpdateInterests.mockResolvedValue({
      source: 'configured',
      options: [{ tag: 'flyers', active: true }],
    });
  });

  function call(method: string, path: string, body?: unknown) {
    return fetch(`${baseUrl}${path}`, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  it('gets and updates one volunteer with only canViewVolunteers', async () => {
    const got = await call('GET', '/admin/coops/coop-1/volunteers/v1');
    expect(got.status).toBe(200);
    expect(await got.json()).toEqual(expect.objectContaining({ id: 'v1', status: 'ACTIVE' }));
    expect(volunteers.adminGet).toHaveBeenCalledWith('coop-1', 'v1');

    const patched = await call('PATCH', '/admin/coops/coop-1/volunteers/v1', {
      status: 'WITHDRAWN',
    });
    expect(patched.status).toBe(200);
    expect(volunteers.adminUpdate).toHaveBeenCalledWith(
      'coop-1',
      'v1',
      expect.objectContaining({ status: 'WITHDRAWN' }),
      expect.objectContaining({ userId: 'user-1' }),
    );
  });

  it('lists form options with only canViewVolunteers and refuses a change', async () => {
    const listed = await call('GET', '/admin/coops/coop-1/volunteers/interests');
    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual(
      expect.objectContaining({ options: [expect.objectContaining({ tag: 'board' })] }),
    );
    expect(volunteers.adminInterestOptions).toHaveBeenCalledWith('coop-1');

    const denied = await call('PATCH', '/admin/coops/coop-1/volunteers/interests', {
      deactivate: ['board'],
    });
    expect(denied.status).toBe(403);
    expect(volunteers.adminUpdateInterests).not.toHaveBeenCalled();
  });

  it('changes form options when the caller has both permissions', async () => {
    session.user = {
      id: 'user-1',
      email: 'admin@example.be',
      role: 'COOP_ADMIN',
      coopIds: ['coop-1'],
      coopPermissions: {
        'coop-1': { canViewVolunteers: true, canManageSettings: true },
      },
    };

    const response = await call('PATCH', '/admin/coops/coop-1/volunteers/interests', {
      deactivate: ['board'],
    });

    expect(response.status).toBe(200);
    expect(volunteers.adminUpdateInterests).toHaveBeenCalledWith(
      'coop-1',
      expect.objectContaining({ deactivate: ['board'] }),
      expect.objectContaining({ userId: 'user-1' }),
    );
  });

  it('refuses a form-option change that has canManageSettings without canViewVolunteers', async () => {
    session.user = {
      id: 'user-1',
      email: 'admin@example.be',
      role: 'COOP_ADMIN',
      coopIds: ['coop-1'],
      coopPermissions: { 'coop-1': { canViewVolunteers: false, canManageSettings: true } },
    };

    const response = await call('PATCH', '/admin/coops/coop-1/volunteers/interests', {
      add: ['board'],
    });

    expect(response.status).toBe(403);
    expect(volunteers.adminUpdateInterests).not.toHaveBeenCalled();
  });

  it('lets SYSTEM_ADMIN change form options without either permission flag', async () => {
    session.user = {
      id: 'sys-1',
      email: 'sys@example.be',
      role: 'SYSTEM_ADMIN',
    };

    const response = await call('PATCH', '/admin/coops/coop-1/volunteers/interests', {
      add: ['board'],
    });

    expect(response.status).toBe(200);
    expect(volunteers.adminUpdateInterests).toHaveBeenCalledWith(
      'coop-1',
      expect.objectContaining({ add: ['board'] }),
      expect.objectContaining({ userId: 'sys-1' }),
    );
  });
});
