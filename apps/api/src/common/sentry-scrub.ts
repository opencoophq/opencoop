import type { ErrorEvent } from '@sentry/nestjs';

const SENSITIVE_HEADERS = new Set(['authorization', 'cookie', 'set-cookie', 'x-api-key']);

function stripQuery(url: string | undefined): string | undefined {
  if (!url) return url;
  const index = url.indexOf('?');
  return index === -1 ? url : url.slice(0, index);
}

/** Strips request bodies, cookies, query strings, and sensitive headers before an event leaves the server. */
export function scrubSentryEvent(event: ErrorEvent): ErrorEvent {
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.query_string;
    event.request.url = stripQuery(event.request.url);

    if (event.request.headers) {
      for (const key of Object.keys(event.request.headers)) {
        if (SENSITIVE_HEADERS.has(key.toLowerCase())) {
          delete event.request.headers[key];
        }
      }
    }
  }

  if (event.breadcrumbs) {
    for (const breadcrumb of event.breadcrumbs) {
      const data = breadcrumb.data;
      if (data) {
        if (typeof data.url === 'string') data.url = stripQuery(data.url);
        if (typeof data.from === 'string') data.from = stripQuery(data.from);
        if (typeof data.to === 'string') data.to = stripQuery(data.to);
      }
    }
  }

  return event;
}
