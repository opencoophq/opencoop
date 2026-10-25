import { lastValueFrom, of, throwError } from 'rxjs';
import { SessionRotationInterceptor } from './session-rotation.interceptor';
import { SESSION_ROTATION_INTERVAL_MS } from './session-lifetime';

function httpContext(options: {
  header?: string;
  sid?: string;
  sst?: number;
  headersSent?: boolean;
}) {
  const setHeader = jest.fn();
  const ctx = {
    switchToHttp: () => ({
      getRequest: () => ({
        headers: options.header ? { 'x-session-rotation': options.header } : {},
        user: options.sid ? { sid: options.sid, sst: options.sst } : undefined,
      }),
      getResponse: () => ({ headersSent: options.headersSent ?? false, setHeader }),
    }),
  };
  return { ctx, setHeader };
}

describe('SessionRotationInterceptor', () => {
  const tokenService = { rotateIfDue: jest.fn() };
  const interceptor = new SessionRotationInterceptor(tokenService as any);
  const due = Math.floor(Date.now() / 1000) - SESSION_ROTATION_INTERVAL_MS / 1000 - 5;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reissues on an authenticated request that opted in and whose session is older than 24h', async () => {
    tokenService.rotateIfDue.mockResolvedValue('next-refresh');
    const { ctx, setHeader } = httpContext({ header: '1', sid: 'sess-1', sst: due });

    await expect(lastValueFrom(interceptor.intercept(ctx as any, { handle: () => of({ ok: true }) }))).resolves.toEqual({
      ok: true,
    });

    expect(tokenService.rotateIfDue).toHaveBeenCalledWith('sess-1');
    expect(setHeader).toHaveBeenCalledWith('x-session-token', 'next-refresh');
  });

  it('leaves the session alone when the client did not opt in', async () => {
    const { ctx, setHeader } = httpContext({ sid: 'sess-1', sst: due });

    await lastValueFrom(interceptor.intercept(ctx as any, { handle: () => of({ ok: true }) }));

    expect(tokenService.rotateIfDue).not.toHaveBeenCalled();
    expect(setHeader).not.toHaveBeenCalled();
  });

  it('does not hit the database while the session token is younger than 24h', async () => {
    const { ctx } = httpContext({
      header: '1',
      sid: 'sess-1',
      sst: Math.floor(Date.now() / 1000),
    });

    await lastValueFrom(interceptor.intercept(ctx as any, { handle: () => of(true) }));

    expect(tokenService.rotateIfDue).not.toHaveBeenCalled();
  });

  it('does not fail the request when rotation throws', async () => {
    tokenService.rotateIfDue.mockRejectedValue(new Error('db down'));
    const { ctx } = httpContext({ header: '1', sid: 'sess-1', sst: due });

    await expect(lastValueFrom(interceptor.intercept(ctx as any, { handle: () => of('ok') }))).resolves.toBe('ok');
  });

  it('does not rotate when the handler failed', async () => {
    const { ctx } = httpContext({ header: '1', sid: 'sess-1', sst: due });

    await expect(
      lastValueFrom(interceptor.intercept(ctx as any, { handle: () => throwError(() => new Error('nope')) })),
    ).rejects.toThrow('nope');
    expect(tokenService.rotateIfDue).not.toHaveBeenCalled();
  });
});
