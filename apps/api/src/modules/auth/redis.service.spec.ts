const client = {
  setex: jest.fn(),
  get: jest.fn(),
  del: jest.fn(),
  getdel: jest.fn(),
  quit: jest.fn(),
};

jest.mock('ioredis', () => ({ __esModule: true, default: jest.fn(() => client) }));

import { RedisService } from './redis.service';

describe('RedisService.getChallenge', () => {
  const service = new RedisService({ get: () => undefined } as any);

  beforeEach(() => jest.clearAllMocks());

  it('reads and deletes the challenge in one atomic GETDEL', async () => {
    client.getdel.mockResolvedValue('challenge-1');

    await expect(service.getChallenge('webauthn:auth:x')).resolves.toBe('challenge-1');

    expect(client.getdel).toHaveBeenCalledWith('webauthn:auth:x');
    expect(client.get).not.toHaveBeenCalled();
    expect(client.del).not.toHaveBeenCalled();
  });

  it('returns null when the challenge is missing or already used', async () => {
    client.getdel.mockResolvedValue(null);

    await expect(service.getChallenge('webauthn:auth:x')).resolves.toBeNull();
  });
});
