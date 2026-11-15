"use client";

import { createContext, useContext } from "react";

/**
 * The signed-in session on a hosted instance, for chrome that offers account
 * actions. `null` in local mode, where there is no session to end.
 */
export type HostedSession = {
  signOut: () => void;
  signingOut: boolean;
};

export const HostedSessionContext = createContext<HostedSession | null>(null);

export function useHostedSession() {
  return useContext(HostedSessionContext);
}
