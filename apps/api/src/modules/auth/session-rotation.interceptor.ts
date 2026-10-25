import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Observable, mergeMap } from 'rxjs';
import { TokenService } from './token.service';
import {
  SESSION_ROTATION_REQUEST_HEADER,
  SESSION_ROTATION_RESPONSE_HEADER,
  sessionRotationDueFromClaim,
} from './session-lifetime';

/**
 * On an authenticated request, reissue a session token older than 24 hours.
 * The browser opts in with the request header; a tab still running the previous
 * bundle does not, so its refresh token stays valid until it expires.
 */
@Injectable()
export class SessionRotationInterceptor implements NestInterceptor {
  private readonly logger = new Logger(SessionRotationInterceptor.name);

  constructor(private readonly tokenService: TokenService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      mergeMap(async (data) => {
        await this.rotateIfRequested(context);
        return data;
      }),
    );
  }

  private async rotateIfRequested(context: ExecutionContext): Promise<void> {
    const http = context.switchToHttp();
    const req = http.getRequest<{
      headers?: Record<string, string | string[] | undefined>;
      user?: { sid?: string; sst?: number };
    }>();
    const res = http.getResponse<{ headersSent?: boolean; setHeader?: (name: string, value: string) => void }>();
    if (req.headers?.[SESSION_ROTATION_REQUEST_HEADER] !== '1') return;

    const sid = req.user?.sid;
    const sst = req.user?.sst;
    if (!sid || typeof sst !== 'number') return;
    if (!sessionRotationDueFromClaim(sst, new Date())) return;
    if (!res?.setHeader || res.headersSent) return;

    try {
      const refreshToken = await this.tokenService.rotateIfDue(sid);
      if (refreshToken) res.setHeader(SESSION_ROTATION_RESPONSE_HEADER, refreshToken);
    } catch (err) {
      this.logger.warn(`Session rotation skipped: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  }
}
