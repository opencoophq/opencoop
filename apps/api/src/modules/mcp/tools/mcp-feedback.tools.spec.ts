jest.mock('../../coops/coops.service', () => ({
  CoopsService: class CoopsService {},
}));

import { ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { BillingService } from '../../billing/billing.service';
import { CoopPermissionsService } from '../../../common/utils/coop-permissions';
import { FeedbackService } from '../feedback/feedback.service';
import { McpAuthStore } from '../mcp-auth.store';
import { McpToolkit } from '../mcp-toolkit';
import { McpFeedbackTools, submitFeedbackParameters } from './mcp-feedback.tools';

const PARAMS = {
  kind: 'bug' as const,
  title: 'list_shareholders ignores status',
  description: 'Called with status ACTIVE, got WITHDRAWN rows.',
};

describe('McpFeedbackTools', () => {
  let tools: McpFeedbackTools;
  const auth = {
    getUserId: () => 'u1',
    getCoopId: () => 'coop-from-auth',
    getApiKeyId: () => 'k1',
    getScope: () => 'READ_ONLY' as const,
  };
  const permissions = { permissionsWithRole: jest.fn() };
  const billing = { isReadOnly: jest.fn() };
  const feedback = { submit: jest.fn() };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        McpFeedbackTools,
        McpToolkit,
        { provide: McpAuthStore, useValue: auth },
        { provide: CoopPermissionsService, useValue: permissions },
        { provide: BillingService, useValue: billing },
        { provide: FeedbackService, useValue: feedback },
      ],
    }).compile();
    tools = module.get(McpFeedbackTools);
    jest.clearAllMocks();
    permissions.permissionsWithRole.mockResolvedValue({
      permissions: { canViewPII: false },
      role: 'COOP_ADMIN',
    });
    billing.isReadOnly.mockResolvedValue(true);
  });

  it('works for a READ_ONLY key without any permission, on a read-only subscription', async () => {
    feedback.submit.mockResolvedValue({
      status: 'created',
      issue_number: 7,
      issue_url: 'https://github.com/opencoophq/opencoop/issues/7',
    });

    await expect(tools.submitFeedback(PARAMS)).resolves.toEqual({
      status: 'created',
      issue_number: 7,
      issue_url: 'https://github.com/opencoophq/opencoop/issues/7',
    });
    expect(feedback.submit).toHaveBeenCalledWith(
      PARAMS,
      expect.objectContaining({ userId: 'u1', coopId: 'coop-from-auth', scope: 'READ_ONLY' }),
    );
    expect(billing.isReadOnly).not.toHaveBeenCalled();
  });

  it('returns disabled as a normal result', async () => {
    feedback.submit.mockResolvedValue({
      status: 'disabled',
      message: 'Feedback reporting is not configured on this server.',
    });

    await expect(tools.submitFeedback(PARAMS)).resolves.toEqual({
      status: 'disabled',
      message: 'Feedback reporting is not configured on this server.',
    });
  });

  it('maps a GitHub failure to a clean MCP error', async () => {
    feedback.submit.mockRejectedValue(
      new ServiceUnavailableException('Feedback could not be filed on GitHub. Try again later.'),
    );

    const error = await tools.submitFeedback(PARAMS).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(McpError);
    expect((error as McpError).code).toBe(ErrorCode.InvalidRequest);
    expect((error as McpError).message).toBe(
      'Feedback could not be filed on GitHub. Try again later.',
    );
  });

  describe('parameters', () => {
    it('accepts a full report and trims the title', () => {
      const parsed = submitFeedbackParameters.parse({
        ...PARAMS,
        title: '  padded  ',
        proposed_fix: 'Filter on status.',
        tool_name: 'opencoop.list_shareholders-v2',
        severity: 'high',
      });
      expect(parsed.title).toBe('padded');
    });

    it.each([
      [{ ...PARAMS, kind: 'praise' }],
      [{ ...PARAMS, title: '   ' }],
      [{ ...PARAMS, title: 'x'.repeat(121) }],
      [{ ...PARAMS, description: '' }],
      [{ ...PARAMS, description: 'x'.repeat(4001) }],
      [{ ...PARAMS, proposed_fix: 'x'.repeat(4001) }],
      [{ ...PARAMS, tool_name: 'x'.repeat(101) }],
      [{ ...PARAMS, tool_name: '' }],
      [{ ...PARAMS, tool_name: 'list shareholders' }],
      [{ ...PARAMS, tool_name: 'jan@example.be' }],
      [{ ...PARAMS, tool_name: '`x`' }],
      [{ ...PARAMS, severity: 'critical' }],
      [{ ...PARAMS, coopId: 'other-coop' }],
      [{ title: 't', description: 'd' }],
    ])('rejects %j', (input) => {
      expect(submitFeedbackParameters.safeParse(input).success).toBe(false);
    });
  });
});
