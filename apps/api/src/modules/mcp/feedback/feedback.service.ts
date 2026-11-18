import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'crypto';
import { sentryEnvironment } from '../../../sentry-environment';
import { feedbackFingerprint, feedbackFingerprintMarker } from './feedback-fingerprint';
import { FeedbackRateLimiter } from './feedback-rate-limiter';
import { scrubFeedbackText } from './feedback-scrubber';
import {
  GitHubFeedbackClient,
  GitHubFeedbackConfig,
  GitHubFeedbackError,
} from './github-feedback.client';

export const FEEDBACK_KINDS = ['bug', 'missing_capability', 'docs', 'other'] as const;
export const FEEDBACK_SEVERITIES = ['low', 'medium', 'high'] as const;

export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];
export type FeedbackSeverity = (typeof FEEDBACK_SEVERITIES)[number];

export interface FeedbackInput {
  kind: FeedbackKind;
  title: string;
  description: string;
  proposed_fix?: string;
  tool_name?: string;
  severity?: FeedbackSeverity;
}

export interface FeedbackResult {
  status: 'created' | 'commented' | 'rate_limited' | 'disabled';
  issue_number?: number;
  issue_url?: string;
  message?: string;
}

export const MCP_SERVER_NAME = 'opencoop';
export const MCP_SERVER_VERSION = '1.0.0';

const DEFAULT_REPO = 'opencoophq/opencoop';
const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const TITLE_MAX = 120;
const TEXT_MAX = 4000;
const UNAVAILABLE_MESSAGE = 'Feedback could not be filed on GitHub. Try again later.';

interface ScrubbedFeedback {
  kind: FeedbackKind;
  title: string;
  description: string;
  proposedFix?: string;
  toolName?: string;
  severity?: FeedbackSeverity;
}

/** Pseudonymous, stable per user, and not reversible to the user id without brute force. */
export function feedbackReporterId(userId: string): string {
  const hash = createHash('sha256').update(`opencoop-mcp-feedback:${userId}`).digest('hex');
  return `anon-${hash.slice(0, 12)}`;
}

@Injectable()
export class FeedbackService {
  private readonly logger = new Logger(FeedbackService.name);
  private readonly labelsReady = new Set<string>();

  constructor(
    private readonly rateLimiter: FeedbackRateLimiter,
    private readonly github: GitHubFeedbackClient,
  ) {}

  async submit(input: FeedbackInput, ctx: { userId: string }): Promise<FeedbackResult> {
    const config = this.readConfig();
    if (!config) {
      return {
        status: 'disabled',
        message: 'Feedback reporting is not configured on this server.',
      };
    }

    const { allowed } = await this.rateLimiter.check(ctx.userId);
    if (!allowed) {
      return { status: 'rate_limited', message: 'Too many feedback reports. Try again later.' };
    }

    const feedback = this.scrub(input);
    const fingerprint = feedbackFingerprint(feedback.kind, feedback.toolName, feedback.title);
    const details = this.details(feedback, ctx.userId);

    try {
      await this.ensureLabels(config);
      const existing = await this.github.findOpenIssueByFingerprint(config, fingerprint);
      if (existing) {
        await this.github.createComment(
          config,
          existing.number,
          `Another agent reported this again.\n\n${details}`,
        );
        return {
          status: 'commented',
          issue_number: existing.number,
          issue_url: existing.html_url,
        };
      }

      const created = await this.github.createIssue(config, {
        title: feedback.title,
        labels: ['mcp-feedback', 'source:agent', `kind:${feedback.kind}`],
        body: [
          details,
          '---',
          '_Filed by the MCP `submit_feedback` tool. Personal data and secrets were redacted automatically before posting._',
          feedbackFingerprintMarker(fingerprint),
        ].join('\n\n'),
      });
      return { status: 'created', issue_number: created.number, issue_url: created.html_url };
    } catch (error) {
      // Only our own messages are logged: never the token, headers or a GitHub response body.
      this.logger.warn(
        error instanceof GitHubFeedbackError ? error.message : 'GitHub feedback failed',
      );
      throw new ServiceUnavailableException(UNAVAILABLE_MESSAGE);
    }
  }

  private readConfig(): GitHubFeedbackConfig | null {
    const token = process.env.MCP_FEEDBACK_GITHUB_TOKEN?.trim();
    if (!token) return null;
    const repo = process.env.MCP_FEEDBACK_GITHUB_REPO?.trim() || DEFAULT_REPO;
    if (!REPO_PATTERN.test(repo)) {
      this.logger.warn('MCP_FEEDBACK_GITHUB_REPO is not owner/name; feedback is disabled');
      return null;
    }
    return { token, repo };
  }

  private async ensureLabels(config: GitHubFeedbackConfig): Promise<void> {
    if (this.labelsReady.has(config.repo)) return;
    if (await this.github.ensureLabels(config)) {
      this.labelsReady.add(config.repo);
    }
  }

  private scrub(input: FeedbackInput): ScrubbedFeedback {
    const clean = (value: string | undefined, max: number): string | undefined => {
      if (value === undefined) return undefined;
      const scrubbed = scrubFeedbackText(value).trim().slice(0, max);
      return scrubbed === '' ? undefined : scrubbed;
    };
    return {
      kind: input.kind,
      title: clean(input.title, TITLE_MAX)?.replace(/\s+/g, ' ') ?? 'Untitled feedback',
      description: clean(input.description, TEXT_MAX) ?? '_empty_',
      proposedFix: clean(input.proposed_fix, TEXT_MAX),
      toolName: clean(input.tool_name, 100),
      severity: input.severity,
    };
  }

  private details(feedback: ScrubbedFeedback, userId: string): string {
    const commit = process.env.APP_VERSION?.trim() || 'unknown';
    const environment = sentryEnvironment(
      process.env.FRONTEND_URL,
      process.env.SENTRY_ENVIRONMENT,
      process.env.NODE_ENV,
    );
    const tool = feedback.toolName
      ? `\`${feedback.toolName.replace(/`/g, '')}\``
      : '_not specified_';
    return [
      [
        `**Kind:** ${feedback.kind}`,
        `**Tool:** ${tool}`,
        `**Severity:** ${feedback.severity ?? '_not specified_'}`,
        `**Server:** ${MCP_SERVER_NAME} MCP ${MCP_SERVER_VERSION} (commit ${commit})`,
        `**Environment:** ${environment}`,
        `**Reporter:** ${feedbackReporterId(userId)}`,
      ].join('\n'),
      `### Description\n\n${feedback.description}`,
      `### Proposed fix\n\n${feedback.proposedFix ?? '_none_'}`,
    ].join('\n\n');
  }
}
