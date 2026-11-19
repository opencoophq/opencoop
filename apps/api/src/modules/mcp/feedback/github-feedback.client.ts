import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { feedbackFingerprintMarker } from './feedback-fingerprint';

export type FeedbackFetch = (url: string, init: RequestInit) => Promise<Response>;
export const FEEDBACK_FETCH = Symbol('FEEDBACK_FETCH');

export interface GitHubFeedbackConfig {
  token: string;
  /** `owner/name`, already validated. */
  repo: string;
}

export interface GitHubIssueRef {
  number: number;
  html_url: string;
}

export const FEEDBACK_LABELS: ReadonlyArray<{ name: string; color: string; description: string }> =
  [
    { name: 'mcp-feedback', color: '5319e7', description: 'Filed by the MCP submit_feedback tool' },
    { name: 'source:agent', color: 'c5def5', description: 'Reported by an AI agent' },
    { name: 'kind:bug', color: 'd73a4a', description: 'MCP feedback: bug' },
    {
      name: 'kind:missing_capability',
      color: 'a2eeef',
      description: 'MCP feedback: missing capability',
    },
    { name: 'kind:docs', color: '0075ca', description: 'MCP feedback: documentation' },
    { name: 'kind:other', color: 'ededed', description: 'MCP feedback: other' },
  ];

const API = 'https://api.github.com';
const TIMEOUT_MS = 10_000;
const LIST_PAGES = 3;

/**
 * Error with a message we build ourselves. It never holds the token, request headers,
 * the response body, or the message of the underlying network error.
 */
export class GitHubFeedbackError extends Error {
  constructor(
    operation: string,
    status: number | 'network error' | 'timeout' | 'invalid response',
  ) {
    super(
      typeof status === 'number'
        ? `GitHub ${operation} failed with status ${status}`
        : `GitHub ${operation} failed: ${status}`,
    );
    this.name = 'GitHubFeedbackError';
  }
}

interface IssueItem {
  number?: unknown;
  html_url?: unknown;
  body?: unknown;
  pull_request?: unknown;
}

@Injectable()
export class GitHubFeedbackClient {
  private readonly logger = new Logger(GitHubFeedbackClient.name);
  private readonly fetchFn: FeedbackFetch;

  constructor(@Optional() @Inject(FEEDBACK_FETCH) fetchFn?: FeedbackFetch) {
    this.fetchFn = fetchFn ?? ((url, init) => fetch(url, init));
  }

  /**
   * Creates the feedback labels. Returns true when every label exists afterwards. Stops at the
   * first network error, timeout, 401 or 403: the next calls would fail the same way.
   */
  async ensureLabels(config: GitHubFeedbackConfig): Promise<boolean> {
    let allReady = true;
    for (const label of FEEDBACK_LABELS) {
      let response: Response;
      try {
        response = await this.request(
          config,
          'create label',
          'POST',
          `/repos/${config.repo}/labels`,
          label,
        );
      } catch (error) {
        this.logger.warn(this.safeMessage(error, 'create label'));
        return false;
      }
      // 422: the label already exists.
      if (response.status === 201 || response.status === 422) continue;
      this.logger.warn(`GitHub create label failed with status ${response.status}`);
      if (response.status === 401 || response.status === 403) return false;
      allReady = false;
    }
    return allReady;
  }

  /** Open feedback issue whose body holds the exact fingerprint marker, or null. */
  async findOpenIssueByFingerprint(
    config: GitHubFeedbackConfig,
    fingerprint: string,
  ): Promise<GitHubIssueRef | null> {
    const marker = feedbackFingerprintMarker(fingerprint);

    const query = `repo:${config.repo} is:issue is:open label:mcp-feedback "${fingerprint}"`;
    try {
      const response = await this.request(
        config,
        'search issues',
        'GET',
        `/search/issues?q=${encodeURIComponent(query)}`,
      );
      if (response.ok) {
        const data = (await response.json()) as { items?: unknown };
        const hit = this.findMarked(Array.isArray(data.items) ? data.items : [], marker);
        if (hit) return hit;
      } else {
        this.logger.warn(`GitHub search issues failed with status ${response.status}`);
      }
    } catch (error) {
      // Search is a shortcut; the listing below is the source of truth.
      this.logger.warn(this.safeMessage(error, 'search issues'));
    }

    for (let page = 1; page <= LIST_PAGES; page++) {
      const response = await this.request(
        config,
        'list issues',
        'GET',
        `/repos/${config.repo}/issues?state=open&labels=mcp-feedback&per_page=100&page=${page}`,
      );
      if (!response.ok) throw new GitHubFeedbackError('list issues', response.status);
      const items = await this.readJson<unknown>(response, 'list issues');
      if (!Array.isArray(items)) return null;
      const hit = this.findMarked(items, marker);
      if (hit) return hit;
      if (items.length < 100) return null;
    }
    return null;
  }

  async createIssue(
    config: GitHubFeedbackConfig,
    issue: { title: string; body: string; labels: string[] },
  ): Promise<GitHubIssueRef> {
    const response = await this.request(
      config,
      'create issue',
      'POST',
      `/repos/${config.repo}/issues`,
      issue,
    );
    if (!response.ok) throw new GitHubFeedbackError('create issue', response.status);
    const data = await this.readJson<IssueItem>(response, 'create issue');
    if (typeof data?.number !== 'number' || typeof data.html_url !== 'string') {
      throw new GitHubFeedbackError('create issue', 'invalid response');
    }
    return { number: data.number, html_url: data.html_url };
  }

  async createComment(
    config: GitHubFeedbackConfig,
    issueNumber: number,
    body: string,
  ): Promise<void> {
    const response = await this.request(
      config,
      'create comment',
      'POST',
      `/repos/${config.repo}/issues/${issueNumber}/comments`,
      { body },
    );
    if (!response.ok) throw new GitHubFeedbackError('create comment', response.status);
  }

  private findMarked(items: unknown[], marker: string): GitHubIssueRef | null {
    for (const raw of items) {
      const item = raw as IssueItem;
      if (!item || typeof item !== 'object' || item.pull_request) continue;
      if (
        typeof item.body === 'string' &&
        item.body.includes(marker) &&
        typeof item.number === 'number' &&
        typeof item.html_url === 'string'
      ) {
        return { number: item.number, html_url: item.html_url };
      }
    }
    return null;
  }

  private async request(
    config: GitHubFeedbackConfig,
    operation: string,
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<Response> {
    try {
      return await this.fetchFn(`${API}${path}`, {
        method,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${config.token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'opencoop-mcp-feedback',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new GitHubFeedbackError(operation, this.isTimeout(error) ? 'timeout' : 'network error');
    }
  }

  private async readJson<T>(response: Response, operation: string): Promise<T> {
    try {
      return (await response.json()) as T;
    } catch (error) {
      throw new GitHubFeedbackError(operation, this.isTimeout(error) ? 'timeout' : 'network error');
    }
  }

  private isTimeout(error: unknown): boolean {
    const name = (error as { name?: unknown } | null)?.name;
    return name === 'TimeoutError' || name === 'AbortError';
  }

  private safeMessage(error: unknown, operation: string): string {
    return error instanceof GitHubFeedbackError
      ? error.message
      : `GitHub ${operation} failed: network error`;
  }
}
