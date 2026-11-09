jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));

import { FeatureRequestsService } from './feature-requests.service';

describe('FeatureRequestsService', () => {
  const prisma = { featureRequest: { create: jest.fn(), update: jest.fn() } };
  const emailService = { sendPlatformEmail: jest.fn() };
  let service: FeatureRequestsService;
  const originalToken = process.env.GITHUB_TOKEN;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.GITHUB_TOKEN;
    prisma.featureRequest.create.mockResolvedValue({ id: 'fr1' });
    emailService.sendPlatformEmail.mockResolvedValue(undefined);
    service = new FeatureRequestsService(prisma as any, emailService as any);
  });

  afterAll(() => {
    if (originalToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = originalToken;
  });

  it('escapes the title in the HTML thank-you mail', async () => {
    await service.create({
      name: 'Jane',
      email: 'Jane@Example.com',
      title: '<img src=x onerror=alert(1)> & "more"',
      description: 'd',
      locale: 'en',
    });

    const thanks = emailService.sendPlatformEmail.mock.calls
      .map(([options]) => options)
      .find((options) => options.templateKey === 'feature-request-thanks');
    expect(thanks.to).toBe('Jane@Example.com');
    expect(thanks.html).toContain('&lt;img src=x onerror=alert(1)&gt; &amp; &quot;more&quot;');
    expect(thanks.html).not.toContain('<img');
  });

  it('keeps the team notification as plain text', async () => {
    await service.create({
      name: 'Jane',
      email: 'j@example.com',
      title: 'A & B',
      description: 'd',
    });

    const notice = emailService.sendPlatformEmail.mock.calls
      .map(([options]) => options)
      .find((options) => options.templateKey === 'feature-request-notification');
    expect(notice.html).toBeUndefined();
    expect(notice.text).toContain('Title: A & B');
  });
});
