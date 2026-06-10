import { clearAllSessions, removeSession, getActiveSessionId, getAllSessions, switchSession, updateActiveSessionToken } from './sessions';

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
      updateActiveSessionToken(data.accessToken);
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
  const activeId = getActiveSessionId();
  if (activeId) removeSession(activeId);

  // If other sessions remain, switch to the first available one
  const remaining = getAllSessions();
  if (remaining.length > 0) {
    switchSession(remaining[0].id);
    window.location.href = '/dashboard';
    return;
  }

  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('user');
  clearAllSessions();
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

/**
 * Shared core: fetch with the auth header, transparently refresh the access
 * token once on 401 and retry, redirect to login if the refresh fails, and
 * surface subscription-required errors. Returns the raw Response (the caller
 * decides how to interpret a non-ok status). Used by both `api()` and `apiFetch()`
 * so the security-sensitive refresh flow lives in exactly one place.
 */
async function fetchWithAuth(path: string, options: FetchOptions = {}): Promise<Response> {
  const { body, headers: customHeaders, ...rest } = options;
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;

  const doFetch = () =>
    fetch(`${API_URL}${path}`, {
      ...rest,
      headers: buildHeaders(customHeaders as Record<string, string>, isFormData),
      body: buildBody(body, isFormData),
    });

  let response = await doFetch();

  // On 401, attempt token refresh and retry once
  if (response.status === 401 && typeof window !== 'undefined') {
    const refreshed = await tryRefreshToken();
    if (refreshed) {
      response = await doFetch();
    }

    if (response.status === 401) {
      clearAuthAndRedirect();
      throw new Error('Unauthorized');
    }
  }

  // Surface subscription-required errors to the UI. Clone the response so its
  // body stays readable by the caller's own error handling below.
  if (!response.ok && response.status === 403 && typeof window !== 'undefined') {
    const error = await response.clone().json().catch(() => ({}));
    if (error.code === 'SUBSCRIPTION_REQUIRED') {
      window.dispatchEvent(new CustomEvent('subscription-required'));
    }
  }

  return response;
}

export async function api<T = unknown>(
  path: string,
  options: FetchOptions = {},
): Promise<T> {
  const response = await fetchWithAuth(path, options);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.message || `HTTP ${response.status}`);
  }

  // Handle empty responses (204 No Content, or 200 with empty body)
  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export async function apiFetch(
  path: string,
  options: FetchOptions = {},
): Promise<Response> {
  const response = await fetchWithAuth(path, options);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response;
}
