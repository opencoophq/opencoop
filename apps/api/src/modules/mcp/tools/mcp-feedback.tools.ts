import { Injectable } from '@nestjs/common';
import { Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { FEEDBACK_KINDS, FEEDBACK_SEVERITIES, FeedbackService } from '../feedback/feedback.service';
import { McpToolkit } from '../mcp-toolkit';

export const submitFeedbackParameters = z
  .object({
    kind: z
      .enum(FEEDBACK_KINDS)
      .describe(
        'bug: a tool failed or returned wrong data. missing_capability: a tool or option you needed does not exist. docs: a tool description or the docs are wrong. other: anything else.',
      ),
    title: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .describe(
        'One-line summary of the problem. Reports with the same kind, tool and title are merged.',
      ),
    description: z
      .string()
      .trim()
      .min(1)
      .max(4000)
      .describe(
        'What you did, what you expected and what happened. Use ids or placeholders, never personal data or secrets.',
      ),
    proposed_fix: z
      .string()
      .max(4000)
      .optional()
      .describe('Optional: how the tool or docs should change.'),
    tool_name: z
      .string()
      .regex(/^[A-Za-z0-9_.-]{1,100}$/)
      .optional()
      .describe(
        'Optional: the OpenCoop MCP tool this is about, e.g. list_shareholders. Letters, digits, _ . - only, at most 100 characters.',
      ),
    severity: z
      .enum(FEEDBACK_SEVERITIES)
      .optional()
      .describe('Optional: high when it blocks your task, low for a minor annoyance.'),
  })
  .strict();

type SubmitFeedbackParams = z.infer<typeof submitFeedbackParameters>;

@Injectable()
export class McpFeedbackTools {
  constructor(
    private readonly feedback: FeedbackService,
    private readonly toolkit: McpToolkit,
  ) {}

  @Tool({
    name: 'submit_feedback',
    description:
      'Report a problem with this OpenCoop MCP server to its maintainers. Use it when an OpenCoop MCP tool failed unexpectedly or returned wrong data, when a capability you needed is missing, or when a tool description or the docs are wrong. It files a GitHub issue that the OpenCoop maintainers can see; identical reports (same kind, tool and title) are merged into one issue as comments. It is rate-limited. You MUST NOT include personal data (names, emails, phone numbers, IBANs, national register numbers, addresses) or secrets (API keys, tokens, passwords): describe the problem with ids or placeholders instead. Personal data that slips through is redacted, but do not rely on that. Works with read-only API keys and never changes coop data. Returns status created, commented, rate_limited or disabled.',
    parameters: submitFeedbackParameters,
  })
  async submitFeedback(params: SubmitFeedbackParams) {
    // No permission and no write flag: a READ_ONLY key may report, and nothing in the coop changes.
    return this.toolkit.run({}, params, (ctx) => this.feedback.submit(params, ctx));
  }
}
