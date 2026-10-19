jest.mock('@sentry/nestjs', () => ({ captureMessage: jest.fn(), captureException: jest.fn() }));

import { ExecutionContext, Logger } from '@nestjs/common';
import { AppleAuthGuard, AppleLoginDisabledError } from './apple-auth.guard';
import { resolveAppleLogin } from '../strategies/apple-login.config';

describe('AppleAuthGuard', () => {
  it('rejects with AppleLoginDisabledError when Apple login is disabled', () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    resolveAppleLogin({ APPLE_CLIENT_ID: 'be.opencoop.test', APPLE_KEY_PATH: '/nonexistent/key.p8' });
    const ctx = { switchToHttp: () => ({ getRequest: () => ({ query: {} }), getResponse: () => ({}) }) } as unknown as ExecutionContext;
    expect(() => new AppleAuthGuard().canActivate(ctx)).toThrow(AppleLoginDisabledError);
  });
});
