// Browser client for `api` (Schema §5). The persona travels as the X-Persona header, read from the cookie.
import { getPersona } from "./persona";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type Role = "client" | "freelancer" | "arbitrator";
export type Status =
  | "DRAFT" | "FUNDED" | "EVALUATING" | "ANCHORING" | "CONFIRMING" | "SUBMITTING_VERDICT"
  | "RELEASED" | "HELD" | "REFUNDED" | "ERROR";
export const ACTIVE: Status[] = ["EVALUATING", "ANCHORING", "CONFIRMING", "SUBMITTING_VERDICT"];
export const TERMINAL: Status[] = ["RELEASED", "HELD", "REFUNDED", "ERROR"];

export type Party = { role: Role; display_name: string; account_id: string; evm_address: string };
export type Persona = Party & { balance_hbar: string | null };

export type Health = {
  db: string; ollama: string; hedera_svc: string; mirror: string;
  model_version: string | null; topic_id: string | null; escrow_contract: string | null;
  forced_eval_error?: boolean;
  replay_mode?: boolean;
};

export type TimelineEvent = { kind: string; message: string; ref: Record<string, any> | null; created_at: string };

export type Contract = {
  id: number; title: string; sow: string; sow_hash: string;
  amount_hbar: string; amount_tinybars: number;
  client: Party; freelancer: Party; arbitrator: Party;
  status: Status; hold_reason: "FAILED_VERDICT" | "EVALUATION_ERROR" | null;
  escrow_id: number | null; disputed: boolean; criteria_ready: boolean;
  error: { step: Status; message: string } | null;
  deliverable: { content: string; submitted_at: string } | null;
  anchor: {
    topic_id: string; tx_id: string; sequence_first: number; sequence_last: number;
    chunk_count: number; consensus_timestamp: string | null; confirmed: boolean;
  } | null;
  txs: { kind: string; tx_hash: string; succeeded: boolean; created_at: string }[];
  timeline: TimelineEvent[];
  created_at: string; updated_at: string;
};

export type ContractSummary = Pick<Contract,
  "id" | "title" | "client" | "freelancer" | "arbitrator" | "amount_hbar" | "amount_tinybars" |
  "status" | "hold_reason" | "disputed" | "escrow_id" | "updated_at">;

export type Evaluation =
  | { available: false; status: Status }
  | {
      available: true; anchored: false;
      criteria: { id: string; description: string; required: boolean }[];
      results: { id: string; met: boolean; evidence: string }[] | null;
      confidence: number | null; injection_suspected: boolean;
      verdict: "pass" | "fail"; reasoning: string; model_version: string; record_timestamp: string;
    };

export type VerifyResponse = {
  db_contract_id: number; status: Status;
  record: Record<string, string> | null;
  anchor: { topic_id: string; tx_id: string; sequence_first: number; sequence_last: number; chunk_count: number } | null;
  escrow: { contract_address: string; escrow_id: number };
};

/** Schema §5.1 error body, or a network failure (status 0). */
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: any) {
    super(message);
  }
}

// Consecutive network failures, for the global "Backend offline" bar (App Flow §8).
type Listener = (offline: boolean) => void;
const listeners = new Set<Listener>();
let offline = false;
function setOffline(v: boolean) {
  if (v === offline) return;
  offline = v;
  listeners.forEach((l) => l(v));
}
export function onOfflineChange(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
export const isOffline = () => offline;

export async function api<T>(path: string, init: RequestInit & { persona?: Role | null } = {}): Promise<T> {
  const { persona = getPersona(), ...rest } = init;
  const headers: Record<string, string> = { ...(rest.headers as Record<string, string>) };
  if (persona) headers["X-Persona"] = persona;
  if (rest.body) headers["Content-Type"] = "application/json";
  let r: Response;
  try {
    r = await fetch(`${API_URL}${path}`, { ...rest, headers, cache: "no-store" });
  } catch (e) {
    setOffline(true);
    throw new ApiError(0, "OFFLINE", "Backend offline");
  }
  setOffline(false);
  const body = r.status === 204 ? null : await r.json().catch(() => null);
  if (!r.ok) {
    const err = body?.error ?? {};
    throw new ApiError(r.status, err.code ?? `HTTP_${r.status}`, err.message ?? r.statusText, err.details);
  }
  return body as T;
}

/** SWR fetcher: the key is the api path. */
export const fetcher = <T,>(path: string) => api<T>(path);
/** Public fetcher for /verify: never sends a persona. */
export const publicFetcher = <T,>(path: string) => api<T>(path, { persona: null });
