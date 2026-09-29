// The persona lives in a cookie (TRD §11). Every tab of one browser profile shares it (App Flow §8).
import type { Role } from "./api";

export const PERSONA_COOKIE = "vte_persona";
export const ROLES: Role[] = ["client", "freelancer", "arbitrator"];
export const ROLE_LABEL: Record<Role, string> = { client: "Client", freelancer: "Freelancer", arbitrator: "Arbitrator" };

export function getPersona(): Role {
  if (typeof document === "undefined") return "client";
  const m = document.cookie.match(new RegExp(`(?:^|; )${PERSONA_COOKIE}=([^;]+)`));
  const v = m?.[1] as Role | undefined;
  return v && ROLES.includes(v) ? v : "client";
}

/** Set the cookie and reload the current page (App Flow §2). */
export function switchPersona(role: Role): void {
  document.cookie = `${PERSONA_COOKIE}=${role}; path=/; max-age=31536000; samesite=lax`;
  window.location.reload();
}
