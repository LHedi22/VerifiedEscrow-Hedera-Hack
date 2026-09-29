"use client";

import { createContext, useContext } from "react";
import { SWRConfig } from "swr";
import type { Role } from "@/lib/api";
import { fetcher, isOffline } from "@/lib/api";

const PersonaContext = createContext<Role>("client");
export const usePersona = () => useContext(PersonaContext);

/** `persona` comes from the cookie on the server, so the first render already matches the browser. */
export default function Providers({ persona, children }: { persona: Role; children: React.ReactNode }) {
  return (
    <SWRConfig value={{ fetcher, revalidateOnFocus: true, shouldRetryOnError: true, errorRetryInterval: 3000, isPaused: isOffline }}>
      <PersonaContext.Provider value={persona}>{children}</PersonaContext.Provider>
    </SWRConfig>
  );
}
