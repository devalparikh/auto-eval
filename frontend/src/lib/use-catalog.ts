"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Catalog } from "@/lib/types";

type CatalogState = {
  data: Catalog | null;
  error: string | null;
  loading: boolean;
};

let state: CatalogState = { data: null, error: null, loading: true };
let inFlight: Promise<void> | null = null;
let requestSequence = 0;
const listeners = new Set<() => void>();

function setState(next: CatalogState) {
  state = next;
  listeners.forEach((listener) => listener());
}

/** One shared fetch and one shared cache for the catalog, across every screen. */
function fetchCatalog(force = false): Promise<void> {
  if (!force && inFlight) return inFlight;
  const requestId = ++requestSequence;
  setState({ data: state.data, error: null, loading: true });
  const request = api
    .catalog()
    .then((data) => {
      if (requestId === requestSequence) {
        setState({ data, error: null, loading: false });
      }
    })
    .catch((caught) => {
      if (requestId === requestSequence) {
        setState({
          data: state.data,
          error: caught instanceof Error ? caught.message : "Unknown error",
          loading: false,
        });
      }
    })
    .finally(() => {
      if (inFlight === request) inFlight = null;
    });
  inFlight = request;
  return request;
}

export function useCatalog() {
  const [, forceRender] = useState(0);

  useEffect(() => {
    const listener = () => forceRender((count) => count + 1);
    listeners.add(listener);
    if (!state.data) {
      void fetchCatalog();
    }
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const reload = useCallback(async () => {
    await fetchCatalog(true);
  }, []);

  return {
    data: state.data,
    error: state.error,
    loading: state.loading,
    reload,
  };
}
