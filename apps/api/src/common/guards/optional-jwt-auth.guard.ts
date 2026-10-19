import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Reads a bearer token when one is present and leaves the request anonymous
 * when it is missing or invalid. Public forms use this to link a logged-in
 * member without rejecting everyone else.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<{ headers?: { authorization?: string } }>();
    const header = request.headers?.authorization;
    if (!header || !header.toLowerCase().startsWith('bearer ')) return true;
    return super.canActivate(context);
  }

  handleRequest<T>(err: unknown, user: T): T | null {
    if (err || !user) return null;
    return user;
  }
}
