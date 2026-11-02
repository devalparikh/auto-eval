"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { api } from "@/lib/api";
import type { Catalog } from "@/lib/types";

type CatalogState = {
  data: Catalog | null;
  error: string | null;
  loading: boolean;
};

const initialState: CatalogState = { data: null, error: null, loading: true };

let state = initialState;
let inFlight: Promise<void> | null = null;
let requestSequence = 0;
const listeners = new Set<() => void>();

function setState(next: CatalogState) {
  state = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
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
  // The sidebar and a screen hydrate at different moments, so the response can
  // arrive between one's render and its subscribing. useSyncExternalStore
  // re-reads the store on subscribe, so that screen cannot miss the update and
  // sit on its skeleton. The server snapshot keeps hydration consistent.
  const current = useSyncExternalStore(
    subscribe,
    () => state,
    () => initialState,
  );

  useEffect(() => {
    if (!state.data) {
      void fetchCatalog();
    }
  }, []);

  const reload = useCallback(async () => {
    await fetchCatalog(true);
  }, []);

  return {
    data: current.data,
    error: current.error,
    loading: current.loading,
    reload,
  };
}
