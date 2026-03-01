import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
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
