import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { isAppleLoginEnabled } from '../strategies/apple-login.config';

/** Thrown when Sign in with Apple is not configured; OAuthCallbackExceptionFilter turns it into /login?error=oauth. */
export class AppleLoginDisabledError extends Error {
  constructor() {
    super('Sign in with Apple is disabled (not configured or private key unusable)');
    this.name = 'AppleLoginDisabledError';
  }
}

@Injectable()
export class AppleAuthGuard extends AuthGuard('apple') {
  canActivate(context: ExecutionContext) {
    if (!isAppleLoginEnabled()) throw new AppleLoginDisabledError();
    return super.canActivate(context);
  }

  getAuthenticateOptions(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    if (req.query.mode === 'prefill' && req.query.redirect) {
      return {
        state: JSON.stringify({ mode: 'prefill', redirect: req.query.redirect }),
      };
    }
    return {};
  }
}
