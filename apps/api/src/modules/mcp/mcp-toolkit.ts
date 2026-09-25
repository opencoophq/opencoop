import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ClassConstructor, plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { Prisma } from '@opencoop/database';
import { Decimal } from '@prisma/client/runtime/library';
import { CoopPermissionKey } from '@opencoop/shared';
import { BillingService } from '../billing/billing.service';
import { CoopPermissionsService, isPermitted } from '../../common/utils/coop-permissions';
import {
  HouseholdCandidate,
  maskHouseholdCandidatesPII,
  maskShareholderListPII,
  maskShareholderPII,
} from '../../common/utils/mask-pii';
import { McpAuthStore } from './mcp-auth.store';

const SECRET_KEYS = new Set(['nationalId', 'giftCode', 'filePath', 'keyHash', 'passwordHash']);

const SUBSCRIPTION_REQUIRED_MESSAGE =
  'Your subscription has expired. Please subscribe to continue.';

export interface McpToolContext {
  userId: string;
  coopId: string;
  apiKeyId: string;
  scope: 'READ_ONLY' | 'READ_WRITE';
  canViewPII: boolean;
  audit: {
    userId: string;
    ip: string;
    userAgent: string;
  };
}

interface McpToolOptions<D> {
  permission?: CoopPermissionKey;
  write?: boolean;
  pii?: 'shareholder' | 'shareholderList' | 'householdCandidates';
  dto?: ClassConstructor<D>;
}

@Injectable()
export class McpToolkit {
  private readonly logger = new Logger(McpToolkit.name);

  constructor(
    private readonly auth: McpAuthStore,
    private readonly coopPermissions: CoopPermissionsService,
    private readonly billingService: BillingService,
  ) {}

  async run<D = undefined, R = unknown>(
    opts: McpToolOptions<D>,
    input: unknown,
    fn: (ctx: McpToolContext, dto: D) => Promise<R>,
  ): Promise<Record<string, unknown> | unknown[]> {
    try {
      const context = await this.buildContext(opts);
      const dto = await this.transformDto(opts.dto, input);
      let result: unknown = await fn(context, dto);

      if (!context.canViewPII && opts.pii === 'shareholder') {
        result = maskShareholderPII(result);
      } else if (!context.canViewPII && opts.pii === 'shareholderList') {
        result = maskShareholderListPII(result);
      } else if (!context.canViewPII && opts.pii === 'householdCandidates') {
        result = maskHouseholdCandidatesPII(result as HouseholdCandidate[]);
      }

      const normalised = this.normalise(result, new WeakSet<object>());
      // Rekog JSON-stringifies arrays and objects once, so bare arrays stay single-encoded.
      if (Array.isArray(normalised) || this.isPlainObject(normalised)) {
        return normalised;
      }
      return { result: normalised };
    } catch (error) {
      throw this.mapError(error);
    }
  }

  private async buildContext<D>(opts: McpToolOptions<D>): Promise<McpToolContext> {
    const userId = this.auth.getUserId();
    const coopId = this.auth.getCoopId();
    const apiKeyId = this.auth.getApiKeyId();
    const scope = this.auth.getScope();
    const { permissions, role } = await this.coopPermissions.permissionsWithRole(userId, coopId);

    if (opts.permission && !isPermitted(permissions, opts.permission)) {
      throw new ForbiddenException('Insufficient permissions');
    }
    if (opts.write && scope !== 'READ_WRITE') {
      throw new ForbiddenException('This API key is read-only');
    }
    if (opts.write && role !== 'SYSTEM_ADMIN' && (await this.billingService.isReadOnly(coopId))) {
      throw new ForbiddenException(SUBSCRIPTION_REQUIRED_MESSAGE);
    }

    return {
      userId,
      coopId,
      apiKeyId,
      scope,
      canViewPII: permissions.canViewPII !== false,
      audit: {
        userId,
        ip: 'mcp',
        userAgent: `mcp-api-key:${apiKeyId}`,
      },
    };
  }

  private async transformDto<D>(
    dtoClass: ClassConstructor<D> | undefined,
    input: unknown,
  ): Promise<D> {
    if (!dtoClass) return undefined as D;

    const dto = plainToInstance(dtoClass, input, {
      enableImplicitConversion: true,
    });
    const errors = await validate(dto as object, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    if (errors.length > 0) {
      throw new BadRequestException(this.flattenValidationErrors(errors).join('; '));
    }
    return dto;
  }

  private flattenValidationErrors(errors: ValidationError[]): string[] {
    const messages: string[] = [];
    for (const error of errors) {
      if (error.constraints) {
        messages.push(...Object.values(error.constraints));
      }
      if (error.children?.length) {
        messages.push(...this.flattenValidationErrors(error.children));
      }
    }
    return messages;
  }

  private normalise(value: unknown, ancestors: WeakSet<object>): unknown {
    if (Decimal.isDecimal(value)) return Number(value);
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'bigint') {
      const numberValue = Number(value);
      return Number.isSafeInteger(numberValue) ? numberValue : value.toString();
    }
    if (Array.isArray(value)) {
      if (ancestors.has(value)) return '[Circular]';
      ancestors.add(value);
      const result = value.map((item) => this.normalise(item, ancestors));
      ancestors.delete(value);
      return result;
    }
    if (!this.isPlainObject(value)) return value;
    if (ancestors.has(value)) return '[Circular]';

    ancestors.add(value);
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (!SECRET_KEYS.has(key)) {
        result[key] = this.normalise(item, ancestors);
      }
    }
    ancestors.delete(value);
    return result;
  }

  private isPlainObject(value: unknown): value is Record<string, unknown> {
    if (value === null || typeof value !== 'object') return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  private mapError(error: unknown): McpError {
    if (error instanceof HttpException) {
      const code =
        error.getStatus() >= 400 && error.getStatus() < 500
          ? ErrorCode.InvalidParams
          : ErrorCode.InvalidRequest;
      return this.mcpError(code, error.message);
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2025') {
        return this.mcpError(ErrorCode.InvalidParams, 'Not found');
      }
      if (error.code === 'P2002') {
        return this.mcpError(ErrorCode.InvalidParams, 'Already exists (duplicate)');
      }
      return this.mcpError(ErrorCode.InvalidParams, 'Invalid input');
    }

    if (
      error instanceof Prisma.PrismaClientValidationError ||
      error instanceof Prisma.PrismaClientUnknownRequestError ||
      error instanceof Prisma.PrismaClientInitializationError ||
      error instanceof Prisma.PrismaClientRustPanicError
    ) {
      return this.mcpError(ErrorCode.InvalidParams, 'Invalid input');
    }

    this.logger.error(error);
    return this.mcpError(ErrorCode.InternalError, 'Internal error');
  }

  private mcpError(code: ErrorCode, message: string): McpError {
    const error = new McpError(code, message);
    // Rekog rethrows McpError; the SDK serializes `.message`, so remove its local code prefix.
    error.message = message;
    return error;
  }
}
