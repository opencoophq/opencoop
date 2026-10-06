/** Rebuilds a query string from Next.js searchParams, for server-side redirects. */
export function toQueryString(params: Record<string, string | string[] | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) value.forEach((v) => query.append(key, v));
    else if (value !== undefined) query.append(key, value);
  }
  const text = query.toString();
  return text ? `?${text}` : '';
}
