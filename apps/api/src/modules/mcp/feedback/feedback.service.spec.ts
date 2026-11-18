import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { feedbackFingerprint, feedbackFingerprintMarker } from './feedback-fingerprint';
import { FeedbackCounterStore, FeedbackRateLimiter } from './feedback-rate-limiter';
import { FeedbackInput, FeedbackService, feedbackReporterId } from './feedback.service';
import { FeedbackFetch, GitHubFeedbackClient } from './github-feedback.client';

const TOKEN = 'ghp_FAKEtoken0000000000000000000000000';
const ENV_KEYS = [
  'MCP_FEEDBACK_GITHUB_TOKEN',
  'MCP_FEEDBACK_GITHUB_REPO',
  'APP_VERSION',
  'FRONTEND_URL',
  'SENTRY_ENVIRONMENT',
  'NODE_ENV',
] as const;

const INPUT: FeedbackInput = {
  kind: 'bug',
  title: 'list_shareholders ignores the status filter',
  description:
    'Called with status ACTIVE for {"name": "Jan Peeters"} jan@example.be, got WITHDRAWN rows.',
  proposed_fix: 'Pass status to the Prisma where clause.',
  tool_name: 'list_shareholders',
  severity: 'high',
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

function sentBody(call: [string, RequestInit]): Record<string, unknown> {
  return JSON.parse(String(call[1].body)) as Record<string, unknown>;
}

describe('FeedbackService', () => {
  const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
  let fetchFn: jest.MockedFunction<FeedbackFetch>;
  let store: { incrWithTtl: jest.Mock };
  let service: FeedbackService;
  let logs: string[];

  /** Routes fake GitHub calls: labels exist, search finds `existing`, creates succeed. */
  function github(existing?: { number: number; html_url: string; body: string }) {
    fetchFn.mockImplementation(async (url, init) => {
      if (url.endsWith('/labels')) return json(422, {});
      if (url.includes('/search/issues')) return json(200, { items: existing ? [existing] : [] });
      if (url.includes('/issues?state=open')) return json(200, []);
      if (url.endsWith('/comments')) return json(201, { id: 1 });
      if (url.endsWith('/issues') && init.method === 'POST') {
        return json(201, {
          number: 99,
          html_url: 'https://github.com/opencoophq/opencoop/issues/99',
        });
      }
      return json(404, {});
    });
  }

  beforeEach(() => {
    for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
    process.env.MCP_FEEDBACK_GITHUB_TOKEN = ` ${TOKEN} `;
    delete process.env.MCP_FEEDBACK_GITHUB_REPO;
    process.env.APP_VERSION = 'abc1234';
    process.env.FRONTEND_URL = 'https://opencoop.be';
    delete process.env.SENTRY_ENVIRONMENT;
    process.env.NODE_ENV = 'production';

    logs = [];
    for (const level of ['log', 'warn', 'error', 'debug'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
        logs.push(
          args
            .map((arg) => (arg instanceof Error ? `${arg.message} ${arg.stack}` : String(arg)))
            .join(' '),
        );
      });
    }

    fetchFn = jest.fn();
    let count = 0;
    store = { incrWithTtl: jest.fn(async () => ++count) };
    service = new FeedbackService(
      new FeedbackRateLimiter(store as FeedbackCounterStore),
      new GitHubFeedbackClient(fetchFn),
    );
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    jest.restoreAllMocks();
  });

  it('is disabled without a token and touches neither Redis nor GitHub', async () => {
    process.env.MCP_FEEDBACK_GITHUB_TOKEN = '   ';

    await expect(service.submit(INPUT, { userId: 'u1' })).resolves.toEqual({
      status: 'disabled',
      message: 'Feedback reporting is not configured on this server.',
    });
    expect(store.incrWithTtl).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('is disabled with a warning when the repo is not owner/name', async () => {
    process.env.MCP_FEEDBACK_GITHUB_REPO = 'opencoophq/opencoop/../../evil';

    await expect(service.submit(INPUT, { userId: 'u1' })).resolves.toMatchObject({
      status: 'disabled',
    });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(logs.join('\n')).toContain('MCP_FEEDBACK_GITHUB_REPO');
  });

  it('returns rate_limited without calling GitHub', async () => {
    store.incrWithTtl.mockResolvedValue(6);

    await expect(service.submit(INPUT, { userId: 'u1' })).resolves.toEqual({
      status: 'rate_limited',
      message: 'Too many feedback reports. Try again later.',
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('creates a labelled issue with a scrubbed body, reporter id and fingerprint marker', async () => {
    github();

    const result = await service.submit(INPUT, { userId: 'user-1' });

    expect(result).toEqual({
      status: 'created',
      issue_number: 99,
      issue_url: 'https://github.com/opencoophq/opencoop/issues/99',
    });
    const createCall = fetchFn.mock.calls.find(
      ([url, init]) => url.endsWith('/repos/opencoophq/opencoop/issues') && init.method === 'POST',
    );
    expect(createCall).toBeDefined();
    const sent = sentBody(createCall!);
    expect(sent.title).toBe(INPUT.title);
    expect(sent.labels).toEqual(['mcp-feedback', 'source:agent', 'kind:bug']);

    const fp = feedbackFingerprint('bug', 'list_shareholders', INPUT.title);
    expect(sent.body).toBe(
      [
        '**Kind:** bug',
        '**Tool:** `list_shareholders`',
        '**Severity:** high',
        '**Server:** opencoop MCP 1.0.0 (commit abc1234)',
        '**Environment:** prod',
        `**Reporter:** ${feedbackReporterId('user-1')}`,
        '',
        '### Description',
        '',
        'Called with status ACTIVE for {"name": "[REDACTED:name]"} [REDACTED:email], got WITHDRAWN rows.',
        '',
        '### Proposed fix',
        '',
        'Pass status to the Prisma where clause.',
        '',
        '---',
        '',
        '_Filed by the MCP `submit_feedback` tool. Personal data and secrets were redacted automatically before posting._',
        '',
        `<!-- mcp-feedback-fingerprint: ${fp} -->`,
      ].join('\n'),
    );
    expect(String(sent.body)).not.toContain('user-1');
    expect(feedbackReporterId('user-1')).toMatch(/^anon-[0-9a-f]{12}$/);
  });

  it('uses placeholders for missing optional fields and the commit fallback', async () => {
    delete process.env.APP_VERSION;
    process.env.FRONTEND_URL = 'https://acc.opencoop.be';
    github();

    await service.submit(
      { kind: 'docs', title: '  Wrong   docs  ', description: 'x' },
      { userId: 'u1' },
    );

    const sent = sentBody(
      fetchFn.mock.calls.find(([url, init]) => url.endsWith('/issues') && init.method === 'POST')!,
    );
    expect(sent.title).toBe('Wrong docs');
    expect(sent.labels).toEqual(['mcp-feedback', 'source:agent', 'kind:docs']);
    expect(sent.body).toContain('**Tool:** _not specified_');
    expect(sent.body).toContain('**Severity:** _not specified_');
    expect(sent.body).toContain('(commit unknown)');
    expect(sent.body).toContain('**Environment:** acc');
    expect(sent.body).toContain('### Proposed fix\n\n_none_');
  });

  it('uses "Untitled feedback" when the title scrubs to nothing and clamps lengths', async () => {
    github();

    await service.submit(
      { kind: 'other', title: ' ', description: 'jan@example.be '.repeat(300) },
      { userId: 'u1' },
    );

    const sent = sentBody(
      fetchFn.mock.calls.find(([url, init]) => url.endsWith('/issues') && init.method === 'POST')!,
    );
    expect(sent.title).toBe('Untitled feedback');
    const description = String(sent.body)
      .split('### Description\n\n')[1]
      .split('\n\n### Proposed')[0];
    expect(description.length).toBeLessThanOrEqual(4000);
    expect(description).not.toContain('@example');
  });

  it('comments on the open issue with the same fingerprint instead of creating one', async () => {
    const fp = feedbackFingerprint('bug', 'list_shareholders', INPUT.title);
    github({
      number: 12,
      html_url: 'https://github.com/opencoophq/opencoop/issues/12',
      body: `old\n${feedbackFingerprintMarker(fp)}`,
    });

    const result = await service.submit(
      { ...INPUT, title: '  LIST_SHAREHOLDERS   ignores the STATUS filter ' },
      { userId: 'u2' },
    );

    expect(result).toEqual({
      status: 'commented',
      issue_number: 12,
      issue_url: 'https://github.com/opencoophq/opencoop/issues/12',
    });
    const comment = fetchFn.mock.calls.find(([url]) => url.endsWith('/issues/12/comments'));
    expect(comment).toBeDefined();
    const body = String(sentBody(comment!).body);
    expect(body).toContain('**Kind:** bug');
    expect(body).toContain(`**Reporter:** ${feedbackReporterId('u2')}`);
    expect(body).toContain('[REDACTED:email]');
    expect(body).not.toContain('jan@example.be');
    expect(
      fetchFn.mock.calls.some(
        ([url, init]) =>
          url.endsWith('/repos/opencoophq/opencoop/issues') && init.method === 'POST',
      ),
    ).toBe(false);
  });

  it('creates the labels once per process after a successful run', async () => {
    github();

    await service.submit(INPUT, { userId: 'u1' });
    await service.submit(INPUT, { userId: 'u1' });

    expect(fetchFn.mock.calls.filter(([url]) => url.endsWith('/labels'))).toHaveLength(6);
  });

  it('still creates the issue when label creation is refused', async () => {
    github();
    const route = fetchFn.getMockImplementation()!;
    fetchFn.mockImplementation(async (url, init) =>
      url.endsWith('/labels') ? json(403, {}) : route(url, init),
    );

    await expect(service.submit(INPUT, { userId: 'u1' })).resolves.toMatchObject({
      status: 'created',
      issue_number: 99,
    });
    expect(fetchFn.mock.calls.filter(([url]) => url.endsWith('/labels'))).toHaveLength(1);
  });

  it('uses MCP_FEEDBACK_GITHUB_REPO when it is valid', async () => {
    process.env.MCP_FEEDBACK_GITHUB_REPO = 'someone/fork.repo';
    github();

    await service.submit(INPUT, { userId: 'u1' });

    expect(fetchFn.mock.calls[0][0]).toBe('https://api.github.com/repos/someone/fork.repo/labels');
  });

  it('throws ServiceUnavailable with a clean message when GitHub refuses the create', async () => {
    github();
    const route = fetchFn.getMockImplementation()!;
    fetchFn.mockImplementation(async (url, init) =>
      url.endsWith('/issues') && init.method === 'POST'
        ? json(500, { message: `server error ${TOKEN}` })
        : route(url, init),
    );

    const error = await service.submit(INPUT, { userId: 'u1' }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as Error).message).toBe(
      'Feedback could not be filed on GitHub. Try again later.',
    );
    expect(logs).toContain('GitHub create issue failed with status 500');
  });

  it('never puts the token in the thrown error or a log line when fetch rejects', async () => {
    fetchFn.mockRejectedValue(
      new Error(`request to github failed, Authorization: Bearer ${TOKEN}`),
    );

    const error = await service.submit(INPUT, { userId: 'u1' }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect(JSON.stringify((error as ServiceUnavailableException).getResponse())).not.toContain(
      TOKEN,
    );
    expect((error as Error).message).not.toContain(TOKEN);
    expect(logs.length).toBeGreaterThan(0);
    for (const line of logs) {
      expect(line).not.toContain(TOKEN);
      expect(line).not.toContain('Authorization');
    }
  });
});

describe('feedbackFingerprint', () => {
  it('is 12 hex chars and ignores case, spacing and personal data in the title', () => {
    const fp = feedbackFingerprint('bug', 'list_shareholders', 'Fails for jan@example.be');
    expect(fp).toMatch(/^[0-9a-f]{12}$/);
    expect(feedbackFingerprint('bug', 'list_shareholders', '  FAILS   for els@example.be ')).toBe(
      fp,
    );
  });

  it('ignores the case of the tool name', () => {
    expect(feedbackFingerprint('bug', 'List_Shareholders', 'x')).toBe(
      feedbackFingerprint('bug', 'list_shareholders', 'x'),
    );
  });

  it('differs per kind and tool', () => {
    const fp = feedbackFingerprint('bug', 'list_shareholders', 'x');
    expect(feedbackFingerprint('docs', 'list_shareholders', 'x')).not.toBe(fp);
    expect(feedbackFingerprint('bug', undefined, 'x')).not.toBe(fp);
  });

  it('builds the marker', () => {
    expect(feedbackFingerprintMarker('abc')).toBe('<!-- mcp-feedback-fingerprint: abc -->');
  });
});
