import { Test } from '@nestjs/testing';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { createHash } from 'crypto';
import { ApiKeysService } from './api-keys.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('ApiKeysService', () => {
  let service: ApiKeysService;

  const mockPrisma = {
    apiKey: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    coopAdmin: {
      findFirst: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ApiKeysService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<ApiKeysService>(ApiKeysService);
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should return a raw key starting with oc_ followed by 40 hex chars', async () => {
      mockPrisma.apiKey.create.mockResolvedValue({
        id: 'key1',
        prefix: 'oc_a1b2c3d',
        name: 'Test Key',
        createdAt: new Date(),
      });

      const result = await service.create('user1', 'coop1', 'Test Key');

      expect(result.rawKey).toMatch(/^oc_[0-9a-f]{40}$/);
    });

    it('should store a SHA-256 hash (64 hex chars) of the raw key', async () => {
      mockPrisma.apiKey.create.mockResolvedValue({
        id: 'key1',
        prefix: 'oc_a1b2c3d',
        name: 'Test Key',
        createdAt: new Date(),
      });

      const result = await service.create('user1', 'coop1', 'Test Key');

      const expectedHash = createHash('sha256').update(result.rawKey).digest('hex');
      expect(expectedHash).toHaveLength(64);
      expect(mockPrisma.apiKey.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            keyHash: expectedHash,
          }),
        }),
      );
    });

    it('should store the prefix as the first 11 chars of the raw key', async () => {
      mockPrisma.apiKey.create.mockResolvedValue({
        id: 'key1',
        prefix: 'oc_a1b2c3d',
        name: 'Test Key',
        createdAt: new Date(),
      });

      const result = await service.create('user1', 'coop1', 'Test Key');

      const expectedPrefix = result.rawKey.substring(0, 11);
      expect(mockPrisma.apiKey.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            prefix: expectedPrefix,
          }),
        }),
      );
    });
  });

  describe('validate', () => {
    it('should return userId and coopId for a valid key with COOP_ADMIN role', async () => {
      const rawKey = 'oc_' + '0'.repeat(40);
      const keyHash = createHash('sha256').update(rawKey).digest('hex');

      mockPrisma.apiKey.findUnique.mockResolvedValue({
        id: 'key1',
        keyHash,
        userId: 'user1',
        coopId: 'coop1',
        revokedAt: null,
        user: { id: 'user1', role: 'COOP_ADMIN' },
      });
      mockPrisma.coopAdmin.findFirst.mockResolvedValue({ id: 'ca1' });
      mockPrisma.apiKey.update.mockResolvedValue({});

      const result = await service.validate(rawKey);

      expect(result).toEqual({ userId: 'user1', coopId: 'coop1' });
    });

    it('should return userId and coopId for a valid key with SYSTEM_ADMIN role', async () => {
      const rawKey = 'oc_' + '1'.repeat(40);
      const keyHash = createHash('sha256').update(rawKey).digest('hex');

      mockPrisma.apiKey.findUnique.mockResolvedValue({
        id: 'key2',
        keyHash,
        userId: 'admin1',
        coopId: 'coop1',
        revokedAt: null,
        user: { id: 'admin1', role: 'SYSTEM_ADMIN' },
      });
      mockPrisma.apiKey.update.mockResolvedValue({});

      const result = await service.validate(rawKey);

      expect(result).toEqual({ userId: 'admin1', coopId: 'coop1' });
      // Should NOT check coopAdmin membership for system admins
      expect(mockPrisma.coopAdmin.findFirst).not.toHaveBeenCalled();
    });

    it('should return null for a revoked key', async () => {
      const rawKey = 'oc_' + '2'.repeat(40);
      const keyHash = createHash('sha256').update(rawKey).digest('hex');

      mockPrisma.apiKey.findUnique.mockResolvedValue({
        id: 'key3',
        keyHash,
        userId: 'user1',
        coopId: 'coop1',
        revokedAt: new Date(),
        user: { id: 'user1', role: 'COOP_ADMIN' },
      });

      const result = await service.validate(rawKey);

      expect(result).toBeNull();
    });

    it('should return null for a non-existent key', async () => {
      mockPrisma.apiKey.findUnique.mockResolvedValue(null);

      const result = await service.validate('oc_nonexistent');

      expect(result).toBeNull();
    });

    it('should return null for a user without admin role (SHAREHOLDER)', async () => {
      const rawKey = 'oc_' + '3'.repeat(40);
      const keyHash = createHash('sha256').update(rawKey).digest('hex');

      mockPrisma.apiKey.findUnique.mockResolvedValue({
        id: 'key4',
        keyHash,
        userId: 'user2',
        coopId: 'coop1',
        revokedAt: null,
        user: { id: 'user2', role: 'SHAREHOLDER' },
      });

      const result = await service.validate(rawKey);

      expect(result).toBeNull();
    });

    it('should return null for COOP_ADMIN without coopAdmin membership', async () => {
      const rawKey = 'oc_' + '4'.repeat(40);
      const keyHash = createHash('sha256').update(rawKey).digest('hex');

      mockPrisma.apiKey.findUnique.mockResolvedValue({
        id: 'key5',
        keyHash,
        userId: 'user3',
        coopId: 'coop1',
        revokedAt: null,
        user: { id: 'user3', role: 'COOP_ADMIN' },
      });
      mockPrisma.coopAdmin.findFirst.mockResolvedValue(null);

      const result = await service.validate(rawKey);

      expect(result).toBeNull();
    });
  });

  describe('findByUser', () => {
    it('should return keys for a given user and coop', async () => {
      const keys = [
        { id: 'key1', prefix: 'oc_abc1234', name: 'Key 1', createdAt: new Date(), lastUsedAt: null },
      ];
      mockPrisma.apiKey.findMany.mockResolvedValue(keys);

      const result = await service.findByUser('user1', 'coop1');

      expect(result).toEqual(keys);
      expect(mockPrisma.apiKey.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { coopId: 'coop1', revokedAt: null, userId: 'user1' },
        }),
      );
    });

    it('should return all keys for the coop when isSystemAdmin is true', async () => {
      const keys = [
        { id: 'key1', prefix: 'oc_abc1234', name: 'Key 1', createdAt: new Date(), lastUsedAt: null },
        { id: 'key2', prefix: 'oc_def5678', name: 'Key 2', createdAt: new Date(), lastUsedAt: null },
      ];
      mockPrisma.apiKey.findMany.mockResolvedValue(keys);

      const result = await service.findByUser('admin1', 'coop1', true);

      expect(result).toEqual(keys);
      expect(mockPrisma.apiKey.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { coopId: 'coop1', revokedAt: null },
        }),
      );
    });
  });

  describe('revoke', () => {
    it('should set revokedAt on the key', async () => {
      mockPrisma.apiKey.findUnique.mockResolvedValue({ id: 'key1', userId: 'user1' });
      mockPrisma.apiKey.update.mockResolvedValue({});

      await service.revoke('key1', 'user1');

      expect(mockPrisma.apiKey.update).toHaveBeenCalledWith({
        where: { id: 'key1' },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('should throw NotFoundException if key does not exist', async () => {
      mockPrisma.apiKey.findUnique.mockResolvedValue(null);

      await expect(service.revoke('nonexistent', 'user1')).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException if key belongs to another user', async () => {
      mockPrisma.apiKey.findUnique.mockResolvedValue({ id: 'key1', userId: 'user2' });

      await expect(service.revoke('key1', 'user1')).rejects.toThrow(ForbiddenException);
    });

    it('should allow system admin to revoke another user\'s key', async () => {
      mockPrisma.apiKey.findUnique.mockResolvedValue({ id: 'key1', userId: 'user2' });
      mockPrisma.apiKey.update.mockResolvedValue({});

      await service.revoke('key1', 'admin1', true);

      expect(mockPrisma.apiKey.update).toHaveBeenCalledWith({
        where: { id: 'key1' },
        data: { revokedAt: expect.any(Date) },
      });
    });
  });
});
