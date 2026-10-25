import { ArgumentsHost, Catch, ExceptionFilter, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';

/**
 * Applied to the Google/Apple OAuth start and callback routes. A failed code exchange
 * (or any other error while finishing an OAuth login) sends the user back to
 * the login page with ?error=oauth instead of a bare 500, and is still
 * reported to GlitchTip.
 */
@Catch()
export class OAuthCallbackExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(OAuthCallbackExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const req = host.switchToHttp().getRequest();
    const res = host.switchToHttp().getResponse();
    const message = exception instanceof Error ? exception.message : String(exception);
    this.logger.warn(`OAuth login failed on ${req?.method} ${req?.url}: ${message}`);
    // A disabled provider was already reported once at boot; don't flood GlitchTip per click.
    if (!(exception instanceof Error && exception.name === 'AppleLoginDisabledError')) {
      Sentry.captureException(exception);
    }

    if (res.headersSent) return;
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3002';
    res.redirect(`${frontendUrl}/login?error=oauth`);
  }
}
