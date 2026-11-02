"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type SetStateAction,
} from "react";

const CACHE_LIMIT = 64;
const cache = new Map<string, unknown>();

function remember(key: string, value: unknown) {
  cache.delete(key);
  cache.set(key, value);
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

export function clearApiResourceCache() {
  cache.clear();
}

export type ApiResourceOptions = {
  /**
   * Keeps the last response for this key in memory. A return visit renders it
   * immediately and refreshes behind it, so `loading` stays false and the
   * screen never drops back to a skeleton. Omit it for data that must not be
   * shown stale.
   */
  cacheKey?: string | null;
};

export function useApiResource<T>(
  loader: (() => Promise<T>) | null,
  dependencies: unknown[] = [],
  { cacheKey = null }: ApiResourceOptions = {},
) {
  const [data, setDataState] = useState<T | null>(() =>
    cacheKey !== null ? ((cache.get(cacheKey) as T | undefined) ?? null) : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(
    () => loader !== null && (cacheKey === null || !cache.has(cacheKey)),
  );
  const loaderRef = useRef(loader);
  const cacheKeyRef = useRef(cacheKey);
  const requestSequence = useRef(0);
  const dependencyKey = JSON.stringify(dependencies);

  const load = useCallback(
    async (currentLoader: () => Promise<T>, key: string | null) => {
      const requestId = ++requestSequence.current;
      const cached = key !== null && cache.has(key);
      if (cached) setDataState(cache.get(key) as T);
      setLoading(!cached);
      setError(null);
      try {
        const result = await currentLoader();
        // An unchanged refresh keeps the same object, so nothing downstream
        // re-renders or rebuilds because of it.
        const unchanged =
          cached && JSON.stringify(cache.get(key)) === JSON.stringify(result);
        if (key !== null && !unchanged) remember(key, result);
        if (requestId === requestSequence.current && !unchanged) {
          setDataState(result);
        }
      } catch (caught) {
        if (requestId === requestSequence.current) {
          setError(caught instanceof Error ? caught.message : "Unknown error");
        }
      } finally {
        if (requestId === requestSequence.current) {
          setLoading(false);
        }
      }
    },
    [],
  );

  const reload = useCallback(async () => {
    if (!loaderRef.current) return;
    await load(loaderRef.current, cacheKeyRef.current);
  }, [load]);

  const setData = useCallback((value: SetStateAction<T | null>) => {
    setDataState((current) => {
      const next =
        typeof value === "function"
          ? (value as (previous: T | null) => T | null)(current)
          : value;
      if (cacheKeyRef.current !== null && next !== null) {
        remember(cacheKeyRef.current, next);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    loaderRef.current = loader;
    cacheKeyRef.current = cacheKey;
    if (!loader) {
      // Invalidate any in-flight request from a previous, non-null loader.
      const requestId = ++requestSequence.current;
      void Promise.resolve().then(() => {
        if (requestId === requestSequence.current) {
          setDataState(null);
          setError(null);
          setLoading(false);
        }
      });
      return;
    }
    void Promise.resolve().then(() => load(loader, cacheKey));
    return () => {
      requestSequence.current += 1;
    };
    // The caller owns dependency identity explicitly, like useEffect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dependencyKey, cacheKey, load]);

  return { data, setData, error, loading, reload };
}
