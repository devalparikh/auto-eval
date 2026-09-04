"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export function useApiResource<T>(
  loader: (() => Promise<T>) | null,
  dependencies: unknown[] = [],
) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(loader !== null);
  const loaderRef = useRef(loader);
  const requestSequence = useRef(0);
  const dependencyKey = JSON.stringify(dependencies);

  const load = useCallback(async (currentLoader: () => Promise<T>) => {
    const requestId = ++requestSequence.current;
    setLoading(true);
    setError(null);
    try {
      const result = await currentLoader();
      if (requestId === requestSequence.current) {
        setData(result);
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
  }, []);

  const reload = useCallback(async () => {
    if (!loaderRef.current) return;
    await load(loaderRef.current);
  }, [load]);

  useEffect(() => {
    loaderRef.current = loader;
    if (!loader) {
      // Invalidate any in-flight request from a previous, non-null loader.
      const requestId = ++requestSequence.current;
      void Promise.resolve().then(() => {
        if (requestId === requestSequence.current) {
          setData(null);
          setError(null);
          setLoading(false);
        }
      });
      return;
    }
    void Promise.resolve().then(() => load(loader));
    return () => {
      requestSequence.current += 1;
    };
    // The caller owns dependency identity explicitly, like useEffect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dependencyKey, load]);

  return { data, setData, error, loading, reload };
}
