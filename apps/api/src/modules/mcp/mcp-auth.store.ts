import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';

interface McpAuthContext {
  userId: string;
  coopId: string;
}

@Injectable()
export class McpAuthStore {
  private readonly storage = new AsyncLocalStorage<McpAuthContext>();

  run<T>(context: McpAuthContext, fn: () => T): T {
    return this.storage.run(context, fn);
  }

  getCoopId(): string {
    const ctx = this.storage.getStore();
    if (!ctx) throw new Error('No MCP auth context — is the request authenticated?');
    return ctx.coopId;
  }

  getUserId(): string {
    const ctx = this.storage.getStore();
    if (!ctx) throw new Error('No MCP auth context — is the request authenticated?');
    return ctx.userId;
  }
}
