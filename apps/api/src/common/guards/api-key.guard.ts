import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { CoopsService } from '../../modules/coops/coops.service';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private coopsService: CoopsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers['authorization'];

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or invalid API key');
    }

    const rawKey = authHeader.substring(7);
    const coop = await this.coopsService.findByApiKey(rawKey);

    if (!coop) {
      throw new UnauthorizedException('Invalid API key');
    }

    // Attach coop to request for downstream use
    request.coop = coop;
    return true;
  }
}
