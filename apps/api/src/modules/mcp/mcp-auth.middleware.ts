import { Injectable, NestMiddleware, UnauthorizedException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { ApiKeysService } from '../api-keys/api-keys.service';
import { McpAuthStore } from './mcp-auth.store';

@Injectable()
export class McpAuthMiddleware implements NestMiddleware {
  constructor(
    private readonly apiKeysService: ApiKeysService,
    private readonly mcpAuthStore: McpAuthStore,
  ) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const authHeader = req.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or invalid API key');
    }

    const rawKey = authHeader.substring(7);
    const result = await this.apiKeysService.validate(rawKey);
    if (!result) {
      throw new UnauthorizedException('Invalid or revoked API key');
    }

    this.mcpAuthStore.run(result, () => {
      next();
    });
  }
}
