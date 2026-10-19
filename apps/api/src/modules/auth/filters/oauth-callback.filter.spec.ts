jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));

import { ArgumentsHost } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { OAuthCallbackExceptionFilter } from './oauth-callback.filter';
import { AppleLoginDisabledError } from '../guards/apple-auth.guard';

function host(res: any): ArgumentsHost {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ method: 'POST', url: '/auth/apple/callback' }),
      getResponse: () => res,
    }),
  } as unknown as ArgumentsHost;
}

describe('OAuthCallbackExceptionFilter', () => {
  const OLD = process.env.FRONTEND_URL;
  beforeEach(() => {
    process.env.FRONTEND_URL = 'https://opencoop.test';
    (Sentry.captureException as jest.Mock).mockClear();
  });
  afterAll(() => {
    process.env.FRONTEND_URL = OLD;
  });

  it('redirects to /login?error=oauth and reports the error when the token exchange fails', () => {
    const res = { headersSent: false, redirect: jest.fn() };
    const err = Object.assign(new Error('Failed to obtain access token'), { name: 'InternalOAuthError' });

    new OAuthCallbackExceptionFilter().catch(err, host(res));

    expect(res.redirect).toHaveBeenCalledWith('https://opencoop.test/login?error=oauth');
    expect(Sentry.captureException).toHaveBeenCalledWith(err);
  });

  it('does not try to redirect when a response was already sent', () => {
    const res = { headersSent: true, redirect: jest.fn() };
    new OAuthCallbackExceptionFilter().catch(new Error('late'), host(res));
    expect(res.redirect).not.toHaveBeenCalled();
  });

  it('redirects without a GlitchTip event per click when Apple login is disabled', () => {
    const res = { headersSent: false, redirect: jest.fn() };
    new OAuthCallbackExceptionFilter().catch(new AppleLoginDisabledError(), host(res));
    expect(res.redirect).toHaveBeenCalledWith('https://opencoop.test/login?error=oauth');
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });
});
