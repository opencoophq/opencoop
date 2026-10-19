import { scrubBreadcrumb, scrubBrowserEvent, scrubSentryEvent } from './sentry';

describe('scrubSentryEvent / scrubBrowserEvent', () => {
  it('strips a magic-link token from the request query string', () => {
    const event = scrubSentryEvent({
      request: {
        url: 'https://opencoop.be/login?token=super-secret-magic-link',
        query_string: 'token=super-secret-magic-link',
        cookies: { session: 'abc' },
        headers: { Referer: 'https://opencoop.be/invite?token=super-secret-magic-link' },
      },
    } as any);

    expect(event.request?.url).toBe('https://opencoop.be/login');
    expect(event.request?.query_string).toBeUndefined();
    expect(event.request?.cookies).toBeUndefined();
    expect(event.request?.headers?.Referer).toBe('https://opencoop.be/invite');
  });

  it('strips an access token from a URL fragment', () => {
    const event = scrubSentryEvent({
      request: {
        url: 'https://opencoop.be/reset#access_token=super-secret-access-token',
      },
    } as any);

    expect(event.request?.url).toBe('https://opencoop.be/reset');
  });

  it('strips breadcrumb navigation/fetch URLs via scrubSentryEvent', () => {
    const event = scrubSentryEvent({
      breadcrumbs: [
        {
          category: 'navigation',
          data: {
            from: 'https://opencoop.be/a?token=secret',
            to: 'https://opencoop.be/b#access_token=secret',
          },
        },
        {
          category: 'fetch',
          data: { url: 'https://opencoop.be/api/x?token=secret' },
        },
      ],
    } as any);

    expect(event.breadcrumbs?.[0].data?.from).toBe('https://opencoop.be/a');
    expect(event.breadcrumbs?.[0].data?.to).toBe('https://opencoop.be/b');
    expect(event.breadcrumbs?.[1].data?.url).toBe('https://opencoop.be/api/x');
  });

  it('scrubBreadcrumb strips a single breadcrumb in place (beforeBreadcrumb hook)', () => {
    const breadcrumb = scrubBreadcrumb({
      category: 'navigation',
      data: { url: 'https://opencoop.be/c?token=secret' },
    } as any);

    expect(breadcrumb.data?.url).toBe('https://opencoop.be/c');
  });

  it('scrubBrowserEvent delegates to the same scrubbing logic', () => {
    const event = scrubBrowserEvent({
      request: { url: 'https://opencoop.be/login?token=secret' },
    } as any);

    expect(event.request?.url).toBe('https://opencoop.be/login');
  });
});
