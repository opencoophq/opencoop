import { UnauthorizedException } from '@nestjs/common';
import { McpAuthMiddleware } from './mcp-auth.middleware';
import { McpAuthStore } from './mcp-auth.store';
import { ApiKeysService } from '../api-keys/api-keys.service';

describe('McpAuthMiddleware', () => {
  let middleware: McpAuthMiddleware;
  let store: McpAuthStore;

  const mockApiKeysService = {
    validate: jest.fn(),
  };

  beforeEach(() => {
    store = new McpAuthStore();
    middleware = new McpAuthMiddleware(
      mockApiKeysService as unknown as ApiKeysService,
      store,
    );
    jest.clearAllMocks();
  });

  it('should throw UnauthorizedException when no Authorization header', async () => {
    const req = { headers: {} } as any;
    const res = {} as any;
    const next = jest.fn();

    await expect(middleware.use(req, res, next)).rejects.toThrow(UnauthorizedException);
    expect(next).not.toHaveBeenCalled();
  });

  it('should throw UnauthorizedException when Authorization header is not Bearer', async () => {
    const req = { headers: { authorization: 'Basic abc123' } } as any;
    const res = {} as any;
    const next = jest.fn();

    await expect(middleware.use(req, res, next)).rejects.toThrow(UnauthorizedException);
    expect(next).not.toHaveBeenCalled();
  });

  it('should throw UnauthorizedException when key is invalid (validate returns null)', async () => {
    mockApiKeysService.validate.mockResolvedValue(null);

    const req = { headers: { authorization: 'Bearer oc_invalid_key' } } as any;
    const res = {} as any;
    const next = jest.fn();

    await expect(middleware.use(req, res, next)).rejects.toThrow(UnauthorizedException);
    expect(mockApiKeysService.validate).toHaveBeenCalledWith('oc_invalid_key');
    expect(next).not.toHaveBeenCalled();
  });

  it('should set auth context and call next() for valid key', async () => {
    const authResult = { userId: 'user1', coopId: 'coop1' };
    mockApiKeysService.validate.mockResolvedValue(authResult);

    const req = { headers: { authorization: 'Bearer oc_valid_key' } } as any;
    const res = {} as any;

    let capturedCoopId: string | undefined;
    let capturedUserId: string | undefined;

    const next = jest.fn(() => {
      capturedCoopId = store.getCoopId();
      capturedUserId = store.getUserId();
    });

    await middleware.use(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(capturedCoopId).toBe('coop1');
    expect(capturedUserId).toBe('user1');
  });
});
