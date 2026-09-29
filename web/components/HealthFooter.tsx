"use client";

import useSWR from "swr";
import type { Health } from "@/lib/api";
import { publicFetcher } from "@/lib/api";
import HashPill from "./HashPill";

const DEPS: [keyof Health, string][] = [["db", "db"], ["ollama", "ollama"], ["hedera_svc", "hedera-svc"], ["mirror", "mirror"]];

/** GET /health every 10 s (App Flow §2). Red if a dependency is down or the forced evaluation-error mode is on. */
export default function HealthFooter() {
  const { data, error } = useSWR<Health>("/health", publicFetcher, { refreshInterval: 10_000, isPaused: () => false });
  const down = data ? DEPS.filter(([k]) => data[k] !== "ok").map(([, l]) => l) : [];
  const forced = !!data?.forced_eval_error;
  const state = error ? "bad" : forced ? "bad" : down.length ? (down.length > 1 || down.includes("db") ? "bad" : "warn") : "";

  return (
    <footer className={`footer ${state}`} data-testid="health-footer" data-state={state || "ok"}>
      <div className="footer-inner">
        <span>testnet</span>
        <span className="row" style={{ gap: 6 }}>topic <HashPill kind="topic" id={data?.topic_id} /></span>
        <span className="row" style={{ gap: 6 }}>contract <HashPill kind="contract" id={data?.escrow_contract} /></span>
        <span className="spacer" />
        {forced && <span className="forced" data-testid="forced-eval-error">⚠ FORCED EVALUATION ERROR (OLLAMA_EVAL_NUM_PREDICT set)</span>}
        {error ? (
          <span className="dep"><span className="dot down" /> api unreachable</span>
        ) : (
          DEPS.map(([k, label]) => (
            <span key={k} className="dep" title={`${label}: ${data?.[k] ?? "…"}`}>
              <span className={`dot ${data ? (data[k] === "ok" ? "ok" : "down") : ""}`} /> {label}
            </span>
          ))
        )}
        <span>
          system{" "}
          <strong style={{ color: state === "" && data ? "#15803d" : state === "warn" ? "var(--amber)" : "var(--red)" }}>
            ● {!data && !error ? "…" : state === "" ? "healthy" : state === "warn" ? "degraded" : "unhealthy"}
          </strong>
        </span>
      </div>
    </footer>
  );
}
