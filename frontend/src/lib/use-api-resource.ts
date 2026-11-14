"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type SetStateAction,
} from "react";

import { apiSessionKey, getApiSession, subscribeApiSession, transitionApiSession } from "@/lib/api-session";
import { ApiError } from "@/lib/api";

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

subscribeApiSession(() => cache.clear());

export function clearApiResourceCache(identity: string | null = null) {
  transitionApiSession(identity);
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
  const session = useSyncExternalStore(subscribeApiSession, getApiSession, getApiSession);
  const scopedKey = cacheKey === null ? null : apiSessionKey(cacheKey, session);
  const [dataSession, setDataSession] = useState(session);
  const dataSessionRef = useRef(session);
  const [data, setDataState] = useState<T | null>(() =>
    cacheKey !== null ? ((cache.get(scopedKey!) as T | undefined) ?? null) : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(
    () => loader !== null && (cacheKey === null || !cache.has(scopedKey!)),
  );
  const loaderRef = useRef(loader);
  const cacheKeyRef = useRef(scopedKey);
  const requestSequence = useRef(0);
  const dependencyKey = JSON.stringify(dependencies);

  const load = useCallback(
    async (currentLoader: () => Promise<T>, key: string | null) => {
      if (getApiSession() !== session) return;
      const requestId = ++requestSequence.current;
      const changedIdentity = dataSessionRef.current !== session;
      dataSessionRef.current = session;
      setDataSession(session);
      const cached = key !== null && cache.has(key);
      if (cached) setDataState(cache.get(key) as T);
      else if (changedIdentity) setDataState(null);
      setLoading(!cached);
      setError(null);
      try {
        const result = await currentLoader();
        if (getApiSession() !== session || requestId !== requestSequence.current) return;
        // An unchanged refresh keeps the same object, so nothing downstream
        // re-renders or rebuilds because of it.
        const unchanged =
          cached && JSON.stringify(cache.get(key)) === JSON.stringify(result);
        if (key !== null && !unchanged) remember(key, result);
        if (requestId === requestSequence.current && !unchanged) {
          setDataState(result);
        }
      } catch (caught) {
        if (getApiSession() === session && requestId === requestSequence.current) {
          if (caught instanceof ApiError && (caught.status === 401 || caught.status === 403)) {
            if (key !== null) cache.delete(key);
            setDataState(null);
          }
          setError(caught instanceof Error ? caught.message : "Unknown error");
        }
      } finally {
        if (getApiSession() === session && requestId === requestSequence.current) {
          setLoading(false);
        }
      }
    },
    [session],
  );

  const reload = useCallback(async () => {
    if (!loaderRef.current) return;
    await load(loaderRef.current, cacheKeyRef.current);
  }, [load]);

  const setData = useCallback((value: SetStateAction<T | null>) => {
    if (getApiSession() !== session) return;
    dataSessionRef.current = session;
    setDataSession(session);
    setDataState((current) => {
      if (getApiSession() !== session) return current;
      const next =
        typeof value === "function"
          ? (value as (previous: T | null) => T | null)(current)
          : value;
      if (cacheKeyRef.current !== null && next !== null) {
        remember(cacheKeyRef.current, next);
      }
      return next;
    });
  }, [session]);

  useEffect(() => {
    loaderRef.current = loader;
    cacheKeyRef.current = scopedKey;
    if (!loader) {
      // Invalidate any in-flight request from a previous, non-null loader.
      const requestId = ++requestSequence.current;
      void Promise.resolve().then(() => {
        if (getApiSession() === session && requestId === requestSequence.current) {
          setDataState(null);
          setError(null);
          setLoading(false);
        }
      });
      return;
    }
    const sequence = requestSequence.current;
    void Promise.resolve().then(() => {
      if (sequence === requestSequence.current) return load(loader, scopedKey);
    });
    return () => {
      requestSequence.current += 1;
    };
    // The caller owns dependency identity explicitly, like useEffect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dependencyKey, scopedKey, load]);

  return {
    data: dataSession === session ? data : null,
    setData, error: dataSession === session ? error : null,
    loading: dataSession === session ? loading : loader !== null, reload,
  };
}
