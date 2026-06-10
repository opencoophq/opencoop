'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';

/**
 * Wraps the load/error/data/reload lifecycle around the shared `api()` helper.
 *
 * Pass `path === null` to skip fetching (e.g. while a required param is not yet
 * available); the hook settles into a non-loading, no-data state without calling
 * the API. Pass extra reactive values via `deps` to refetch when they change.
 */
export function useApiData<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    if (path === null) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    api<T>(path)
      .then((d) => setData(d))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { data, loading, error, reload, setData };
}
