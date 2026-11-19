import { Logger } from '@nestjs/common';
import { feedbackFingerprintMarker } from './feedback-fingerprint';
import {
  FEEDBACK_LABELS,
  FeedbackFetch,
  GitHubFeedbackClient,
  GitHubFeedbackError,
} from './github-feedback.client';

const CONFIG = { token: 'ghp_faketoken1234567890abcdef', repo: 'opencoophq/opencoop' };
const FP = 'abc123def456';
const MARKER = feedbackFingerprintMarker(FP);

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('GitHubFeedbackClient', () => {
  let fetchFn: jest.MockedFunction<FeedbackFetch>;
  let client: GitHubFeedbackClient;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    fetchFn = jest.fn();
    client = new GitHubFeedbackClient(fetchFn);
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('sends the GitHub headers, the token and a timeout signal', async () => {
    fetchFn.mockResolvedValue(json(201, { number: 7, html_url: 'https://github.com/x/7' }));

    await client.createIssue(CONFIG, { title: 't', body: 'b', labels: ['mcp-feedback'] });

    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/opencoophq/opencoop/issues');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${CONFIG.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'opencoop-mcp-feedback',
      'Content-Type': 'application/json',
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(init.body))).toEqual({
      title: 't',
      body: 'b',
      labels: ['mcp-feedback'],
    });
  });

  describe('findOpenIssueByFingerprint', () => {
    it('returns a search hit only when its body holds the exact marker', async () => {
      fetchFn.mockResolvedValueOnce(
        json(200, {
          items: [
            { number: 1, html_url: 'u1', body: `mentions ${FP} in text` },
            { number: 2, html_url: 'u2', body: `x\n${MARKER}` },
          ],
        }),
      );

      await expect(client.findOpenIssueByFingerprint(CONFIG, FP)).resolves.toEqual({
        number: 2,
        html_url: 'u2',
      });
      const query = new URL(fetchFn.mock.calls[0][0]).searchParams.get('q');
      expect(query).toBe(`repo:opencoophq/opencoop is:issue is:open label:mcp-feedback "${FP}"`);
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it('falls back to listing open issues when search is refused, skipping pull requests', async () => {
      fetchFn
        .mockResolvedValueOnce(json(403, { message: 'secondary rate limit' }))
        .mockResolvedValueOnce(
          json(200, [
            { number: 3, html_url: 'u3', body: MARKER, pull_request: {} },
            { number: 4, html_url: 'u4', body: `body ${MARKER}` },
          ]),
        );

      await expect(client.findOpenIssueByFingerprint(CONFIG, FP)).resolves.toEqual({
        number: 4,
        html_url: 'u4',
      });
      expect(fetchFn.mock.calls[1][0]).toBe(
        'https://api.github.com/repos/opencoophq/opencoop/issues?state=open&labels=mcp-feedback&per_page=100&page=1',
      );
    });

    it('lists at most 3 pages and returns null without a match', async () => {
      const fullPage = Array.from({ length: 100 }, (_, i) => ({
        number: i,
        html_url: `u${i}`,
        body: 'other',
      }));
      fetchFn
        .mockResolvedValueOnce(json(200, { items: [] }))
        .mockResolvedValueOnce(json(200, fullPage))
        .mockResolvedValueOnce(json(200, fullPage))
        .mockResolvedValueOnce(json(200, fullPage));

      await expect(client.findOpenIssueByFingerprint(CONFIG, FP)).resolves.toBeNull();
      expect(fetchFn).toHaveBeenCalledTimes(4);
    });

    it('stops listing at a short page', async () => {
      fetchFn
        .mockRejectedValueOnce(new Error('socket hang up'))
        .mockResolvedValueOnce(json(200, [{ number: 1, html_url: 'u', body: 'x' }]));

      await expect(client.findOpenIssueByFingerprint(CONFIG, FP)).resolves.toBeNull();
      expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it('throws when the listing fails', async () => {
      fetchFn
        .mockResolvedValueOnce(json(500, {}))
        .mockResolvedValueOnce(json(502, { message: 'bad gateway' }));

      await expect(client.findOpenIssueByFingerprint(CONFIG, FP)).rejects.toThrow(
        'GitHub list issues failed with status 502',
      );
    });
  });

  describe('ensureLabels', () => {
    it('treats 201 and 422 as success', async () => {
      fetchFn.mockImplementation(async () => json(422, { message: 'already_exists' }));
      fetchFn.mockResolvedValueOnce(json(201, {}));

      await expect(client.ensureLabels(CONFIG)).resolves.toBe(true);
      expect(fetchFn).toHaveBeenCalledTimes(FEEDBACK_LABELS.length);
      expect(fetchFn.mock.calls.map(([, init]) => JSON.parse(String(init.body)).name)).toEqual([
        'mcp-feedback',
        'source:agent',
        'kind:bug',
        'kind:missing_capability',
        'kind:docs',
        'kind:other',
      ]);
      expect(warn).not.toHaveBeenCalled();
    });

    it.each([401, 403])('stops after a %i and logs only the status code', async (status) => {
      fetchFn.mockImplementation(async () => json(201, {}));
      fetchFn.mockResolvedValueOnce(json(status, { message: 'Resource not accessible' }));

      await expect(client.ensureLabels(CONFIG)).resolves.toBe(false);
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(`GitHub create label failed with status ${status}`);
    });

    it.each([
      ['network error', new Error(`boom ${CONFIG.token}`)],
      ['timeout', Object.assign(new Error('aborted'), { name: 'TimeoutError' })],
    ])('stops after a %s', async (kind, error) => {
      fetchFn.mockImplementation(async () => json(201, {}));
      fetchFn.mockRejectedValueOnce(error);

      await expect(client.ensureLabels(CONFIG)).resolves.toBe(false);
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(`GitHub create label failed: ${kind}`);
    });

    it('logs only the status code on another failure and continues', async () => {
      fetchFn.mockImplementation(async () => json(201, {}));
      fetchFn.mockResolvedValueOnce(json(500, { message: 'Server error' }));

      await expect(client.ensureLabels(CONFIG)).resolves.toBe(false);
      expect(fetchFn).toHaveBeenCalledTimes(FEEDBACK_LABELS.length);
      expect(warn).toHaveBeenCalledWith('GitHub create label failed with status 500');
    });
  });

  describe('errors', () => {
    it('throws a status-only error on a non-2xx create', async () => {
      fetchFn.mockResolvedValue(json(422, { message: `bad ${CONFIG.token}` }));

      const error = await client.createComment(CONFIG, 5, 'body').then(
        () => undefined,
        (caught: unknown) => caught as Error,
      );

      expect(error).toBeInstanceOf(GitHubFeedbackError);
      expect(error?.message).toBe('GitHub create comment failed with status 422');
    });

    it('hides the network error message, which may hold the token', async () => {
      fetchFn.mockRejectedValue(new Error(`connect failed for ${CONFIG.token}`));

      const error = await client.createIssue(CONFIG, { title: 't', body: 'b', labels: [] }).then(
        () => undefined,
        (caught: unknown) => caught as Error,
      );

      expect(error).toBeInstanceOf(GitHubFeedbackError);
      expect(error?.message).toBe('GitHub create issue failed: network error');
    });

    it('reports a timeout', async () => {
      fetchFn.mockRejectedValue(Object.assign(new Error('aborted'), { name: 'TimeoutError' }));

      await expect(
        client.createIssue(CONFIG, { title: 't', body: 'b', labels: [] }),
      ).rejects.toThrow('GitHub create issue failed: timeout');
    });
  });
});
