"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { api } from "@/lib/api";
import {
  getApiSession,
  subscribeApiSession,
  type ApiSession,
} from "@/lib/api-session";
import type { Catalog } from "@/lib/types";

type CatalogState = {
  data: Catalog | null;
  error: string | null;
  loading: boolean;
  /** The auth generation that produced this state. Another one never sees it. */
  session: ApiSession | null;
};

const initialState: CatalogState = {
  data: null,
  error: null,
  loading: true,
  session: null,
};

let state: CatalogState = { ...initialState, session: getApiSession() };
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

// The catalog belongs to whoever was signed in when it loaded. An auth
// transition drops it and orphans any request still in flight, so a later
// identity starts from nothing and refetches under its own session.
subscribeApiSession(() => {
  requestSequence += 1;
  inFlight = null;
  setState({ ...initialState, session: getApiSession() });
});

function isAuthDenial(caught: unknown) {
  const status =
    caught && typeof caught === "object" && "status" in caught
      ? (caught as { status: unknown }).status
      : null;
  return status === 401 || status === 403;
}

/** One shared fetch and one shared cache for the catalog, across every screen. */
function fetchCatalog(force = false): Promise<void> {
  const session = getApiSession();
  if (!force && inFlight && state.session === session) return inFlight;
  const requestId = ++requestSequence;
  const current = () => requestId === requestSequence && getApiSession() === session;
  setState({
    data: state.session === session ? state.data : null,
    error: null,
    loading: true,
    session,
  });
  const request = api
    .catalog()
    .then((data) => {
      if (current()) setState({ data, error: null, loading: false, session });
    })
    .catch((caught) => {
      if (!current()) return;
      setState({
        data: isAuthDenial(caught) ? null : state.data,
        error: caught instanceof Error ? caught.message : "Unknown error",
        loading: false,
        session,
      });
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
  const session = useSyncExternalStore(
    subscribeApiSession,
    getApiSession,
    getApiSession,
  );
  const stored = useSyncExternalStore(
    subscribe,
    () => state,
    () => initialState,
  );
  // Never render a catalog from another auth generation, even for the one
  // render between a transition and the store's reset reaching this hook.
  const current = stored.session === session ? stored : initialState;

  useEffect(() => {
    if (!state.data || state.session !== getApiSession()) {
      void fetchCatalog();
    }
  }, [session]);

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
