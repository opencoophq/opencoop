const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface FetchOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
}

export function resolveLogoUrl(logoUrl: string | null | undefined): string | null {
  if (!logoUrl) return null;
  if (logoUrl.startsWith('http')) return logoUrl;
  return `${API_URL}${logoUrl}`;
}

// Prevent concurrent refresh requests
let refreshPromise: Promise<boolean> | null = null;

async function tryRefreshToken(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const refreshToken = localStorage.getItem('refreshToken');
    if (!refreshToken) return false;

    try {
      const response = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      if (!response.ok) return false;

      const data = await response.json();
      localStorage.setItem('accessToken', data.accessToken);
      return true;
    } catch {
      return false;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

function clearAuthAndRedirect() {
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('user');
  window.location.href = '/login';
}

function buildHeaders(
  customHeaders: Record<string, string> | undefined,
  isFormData: boolean,
): Record<string, string> {
  const headers: Record<string, string> = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...(customHeaders || {}),
  };

  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  return headers;
}

function buildBody(body: unknown, isFormData: boolean): BodyInit | undefined {
  if (isFormData) return body as FormData;
  if (body) return JSON.stringify(body);
  return undefined;
}

export async function api<T = unknown>(
  path: string,
  options: FetchOptions = {},
): Promise<T> {
  const { body, headers: customHeaders, ...rest } = options;
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;

  let response = await fetch(`${API_URL}${path}`, {
    ...rest,
    headers: buildHeaders(customHeaders as Record<string, string>, isFormData),
    body: buildBody(body, isFormData),
  });

  // On 401, attempt token refresh and retry once
  if (response.status === 401 && typeof window !== 'undefined') {
    const refreshed = await tryRefreshToken();
    if (refreshed) {
      response = await fetch(`${API_URL}${path}`, {
        ...rest,
        headers: buildHeaders(customHeaders as Record<string, string>, isFormData),
        body: buildBody(body, isFormData),
      });
    }

    if (response.status === 401) {
      clearAuthAndRedirect();
      throw new Error('Unauthorized');
    }
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));

    // Handle subscription-required errors
    if (response.status === 403 && error.code === 'SUBSCRIPTION_REQUIRED') {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('subscription-required'));
      }
    }

    throw new Error(error.message || `HTTP ${response.status}`);
  }

  // Handle empty responses (204 No Content)
  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

export async function apiFetch(
  path: string,
  options: FetchOptions = {},
): Promise<Response> {
  const { body, headers: customHeaders, ...rest } = options;
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;

  let response = await fetch(`${API_URL}${path}`, {
    ...rest,
    headers: buildHeaders(customHeaders as Record<string, string>, isFormData),
    body: buildBody(body, isFormData),
  });

  // On 401, attempt token refresh and retry once
  if (response.status === 401 && typeof window !== 'undefined') {
    const refreshed = await tryRefreshToken();
    if (refreshed) {
      response = await fetch(`${API_URL}${path}`, {
        ...rest,
        headers: buildHeaders(customHeaders as Record<string, string>, isFormData),
        body: buildBody(body, isFormData),
      });
    }

    if (response.status === 401) {
      clearAuthAndRedirect();
      throw new Error('Unauthorized');
    }
  }

  if (!response.ok) {
    if (response.status === 403) {
      const error = await response.clone().json().catch(() => ({}));
      if (error.code === 'SUBSCRIPTION_REQUIRED' && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('subscription-required'));
      }
    }
    throw new Error(`HTTP ${response.status}`);
  }

  return response;
}
