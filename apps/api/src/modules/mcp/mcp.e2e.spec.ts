import {
  INestApplication,
  Injectable,
  MiddlewareConsumer,
  Module,
  NestModule,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { McpModule, McpTransportType, Tool } from '@rekog/mcp-nest';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import { ApiKeyScope } from '@opencoop/database';
import { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service';
import { CoopPermissionsService } from '../../common/utils/coop-permissions';
import { AnalyticsService } from '../admin/analytics.service';
import { ReportsService } from '../admin/reports.service';
import { ApiKeysService } from '../api-keys/api-keys.service';
import { BillingService } from '../billing/billing.service';
import { MessagesService } from '../messages/messages.service';
import { PaymentsService } from '../payments/payments.service';
import { RegistrationsService } from '../registrations/registrations.service';
import { ShareholdersService } from '../shareholders/shareholders.service';
import { McpAuthMiddleware } from './mcp-auth.middleware';
import { McpAuthStore } from './mcp-auth.store';
import { McpToolkit } from './mcp-toolkit';
import { McpAnalyticsTools } from './tools/mcp-analytics.tools';
import { McpCoopTools } from './tools/mcp-coop.tools';
import { McpMessageTools } from './tools/mcp-message.tools';
import { McpShareholderTools } from './tools/mcp-shareholder.tools';
import { McpTransactionTools } from './tools/mcp-transaction.tools';

jest.mock('../admin/reports.service', () => ({
  ReportsService: class ReportsService {},
}));
jest.mock('../admin/analytics.service', () => ({
  AnalyticsService: class AnalyticsService {},
}));
jest.mock('../messages/messages.service', () => ({
  MessagesService: class MessagesService {},
}));
jest.mock('../payments/payments.service', () => ({
  PaymentsService: class PaymentsService {},
}));
jest.mock('../registrations/registrations.service', () => ({
  RegistrationsService: class RegistrationsService {},
}));
jest.mock('../shareholders/shareholders.service', () => ({
  ShareholdersService: class ShareholdersService {},
}));

const EXISTING_TOOL_NAMES = [
  'get_coop_info',
  'get_coop_stats',
  'list_share_classes',
  'list_projects',
  'list_shareholders',
  'get_shareholder',
  'list_registrations',
  'get_registration',
  'approve_registration',
  'reject_registration',
  'cancel_registration',
  'create_transfer',
  'buy_shares_for_shareholder',
  'sell_shares_for_shareholder',
  'get_payment_details',
  'complete_registration',
  'set_payment_date',
  'add_payment',
  'resend_payment_email',
  'get_capital_timeline',
  'get_capital_by_project',
  'get_shareholder_growth',
  'get_transaction_summary',
  'get_annual_overview',
  'create_message_draft',
  'update_message_draft',
  'get_message_draft',
];

const apiKeysService = {
  validate: jest.fn(async (rawKey: string) => {
    const scope =
      rawKey === 'oc_read_only'
        ? ApiKeyScope.READ_ONLY
        : rawKey === 'oc_read_write'
          ? ApiKeyScope.READ_WRITE
          : null;
    return scope ? { userId: 'user1', coopId: 'coop1', apiKeyId: `key-${scope}`, scope } : null;
  }),
};

const prismaService = {
  coop: {
    findUniqueOrThrow: jest.fn(async () => ({ id: 'coop1', name: 'Test Cooperative' })),
  },
  project: { findFirst: jest.fn() },
};

const coopPermissionsService = {
  permissions: jest.fn(async () => ({ canViewPII: true, canManageMessages: true })),
  has: jest.fn(async () => true),
};

const billingService = {
  isReadOnly: jest.fn(async () => false),
};

const shareholdersService = { findAll: jest.fn(), findById: jest.fn() };
const registrationsService = {
  findAll: jest.fn(),
  findById: jest.fn(),
  approve: jest.fn(),
  reject: jest.fn(),
  cancel: jest.fn(),
  createTransfer: jest.fn(),
  createBuy: jest.fn(),
  createSell: jest.fn(),
  getPaymentDetails: jest.fn(),
  complete: jest.fn(),
  updatePaymentDate: jest.fn(),
  resendPaymentEmail: jest.fn(),
};
const paymentsService = { addPayment: jest.fn() };
const analyticsService = {
  getCapitalTimeline: jest.fn(),
  getCapitalByProject: jest.fn(),
  getShareholderGrowth: jest.fn(),
  getTransactionSummary: jest.fn(),
};
const reportsService = { getAnnualOverview: jest.fn() };
const messagesService = {
  createConversation: jest.fn(),
  updateDraft: jest.fn(),
  findByIdForAdmin: jest.fn(),
  countRecipients: jest.fn(),
};

@Injectable()
class TestWriteTools {
  constructor(private readonly toolkit: McpToolkit) {}

  @Tool({
    name: 'test_write_scope',
    description: 'Test-only write tool for the MCP HTTP harness.',
    parameters: z.object({ value: z.string() }).strict(),
  })
  async write(params: { value: string }) {
    return this.toolkit.run({ write: true }, params, async (ctx) => ({
      value: params.value,
      scope: ctx.scope,
    }));
  }
}

const toolProviders = [
  McpCoopTools,
  McpShareholderTools,
  McpTransactionTools,
  McpAnalyticsTools,
  McpMessageTools,
  TestWriteTools,
];

@Module({
  imports: [McpModule.forFeature(toolProviders, 'opencoop-test')],
  providers: [
    McpAuthStore,
    McpToolkit,
    ...toolProviders,
    { provide: PrismaService, useValue: prismaService },
    { provide: CoopPermissionsService, useValue: coopPermissionsService },
    { provide: BillingService, useValue: billingService },
    { provide: ShareholdersService, useValue: shareholdersService },
    { provide: RegistrationsService, useValue: registrationsService },
    { provide: PaymentsService, useValue: paymentsService },
    { provide: AnalyticsService, useValue: analyticsService },
    { provide: ReportsService, useValue: reportsService },
    { provide: MessagesService, useValue: messagesService },
  ],
  exports: [McpAuthStore],
})
class TestMcpToolsModule {}

@Module({
  imports: [
    McpModule.forRoot({
      name: 'opencoop-test',
      version: '1.0.0',
      transport: McpTransportType.STREAMABLE_HTTP,
      capabilities: { tools: {} },
      streamableHttp: {
        statelessMode: true,
        enableJsonResponse: true,
      },
      logging: false,
    }),
    TestMcpToolsModule,
  ],
  providers: [McpAuthMiddleware, { provide: ApiKeysService, useValue: apiKeysService }],
})
class TestMcpModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(McpAuthMiddleware).forRoutes('mcp');
  }
}

interface JsonRpcResponse {
  result?: {
    tools?: Array<{ name: string }>;
    content?: Array<{ type: string; text: string }>;
    isError?: boolean;
    serverInfo?: { name: string };
  };
  error?: { code: number; message: string };
}

describe('MCP HTTP transport', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TestMcpModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
  });

  async function postMcp(
    body: Record<string, unknown>,
    apiKey?: string,
  ): Promise<{ status: number; body: JsonRpcResponse }> {
    const response = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(body),
    });
    return {
      status: response.status,
      body: (await response.json()) as JsonRpcResponse,
    };
  }

  it('returns 401 without an API key', async () => {
    const response = await postMcp({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {},
    });

    expect(response.status).toBe(401);
  });

  it('initializes over stateless JSON transport', async () => {
    const response = await postMcp(
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'initialize',
        params: {
          protocolVersion: LATEST_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: 'mcp-e2e', version: '1.0.0' },
        },
      },
      'oc_read_only',
    );

    expect(response.status).toBe(200);
    expect(response.body.error).toBeUndefined();
    expect(response.body.result?.serverInfo?.name).toBe('opencoop-test');
  });

  it('lists all 27 existing tools', async () => {
    const response = await postMcp(
      { jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} },
      'oc_read_only',
    );
    const names = response.body.result?.tools?.map((tool) => tool.name) ?? [];

    expect(response.status).toBe(200);
    expect(response.body.error).toBeUndefined();
    expect(names).toEqual(expect.arrayContaining(EXISTING_TOOL_NAMES));
    expect(names.filter((name) => name !== 'test_write_scope')).toHaveLength(27);
  });

  it('calls an existing tool end-to-end', async () => {
    const response = await postMcp(
      {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'get_coop_info', arguments: {} },
      },
      'oc_read_only',
    );

    expect(response.status).toBe(200);
    expect(response.body.error).toBeUndefined();
    expect(response.body.result?.isError).not.toBe(true);
    expect(response.body.result?.content?.[0].text).toContain('Test Cooperative');
    expect(prismaService.coop.findUniqueOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'coop1' } }),
    );
  });

  it('refuses a read-only key and accepts a read-write key for the same write tool', async () => {
    const call = {
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'test_write_scope', arguments: { value: 'saved' } },
    };

    const readOnlyResponse = await postMcp({ ...call, id: 5 }, 'oc_read_only');
    expect(readOnlyResponse.status).toBe(200);
    expect(readOnlyResponse.body.error).toEqual({
      code: -32602,
      message: 'This API key is read-only',
    });

    const readWriteResponse = await postMcp({ ...call, id: 6 }, 'oc_read_write');
    expect(readWriteResponse.status).toBe(200);
    expect(readWriteResponse.body.error).toBeUndefined();
    expect(JSON.parse(readWriteResponse.body.result?.content?.[0].text ?? '{}')).toEqual({
      value: 'saved',
      scope: 'READ_WRITE',
    });
  });
});
