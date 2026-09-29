"use client";

import { useEffect, useRef, useState } from "react";
import { hashscanUrl } from "canonical";
import type { Contract } from "@/lib/api";
import { isOffline, onOfflineChange } from "@/lib/api";
import { hbar } from "@/lib/format";
import HashPill from "./HashPill";

// App Flow §7: bottom-right, 5 s; errors are red and sticky until dismissed.
// Pages fire `vte:toast` for actions (draft, fund, submit, resolve); pipeline events come from `vte:status`,
// which the contract page fires when a polled status changes.
type Toast = { id: number; message: string; tx?: string; hcsTx?: string; error?: boolean };

const STEP: Record<string, string> = { EVALUATING: "Evaluating", ANCHORING: "Anchoring", CONFIRMING: "Confirming", SUBMITTING_VERDICT: "Verdict" };

function fromStatus(c: Contract, from: string | undefined): Omit<Toast, "id"> | null {
  if (!from || from === c.status) return null; // first load is not an event
  const a = c.anchor;
  if (c.status === "CONFIRMING" && a) return { message: `Record anchored on Hedera · msgs #${a.sequence_first}–${a.sequence_last}`, hcsTx: a.tx_id };
  if (c.status === "RELEASED" && from !== "HELD")
    return { message: `${hbar(c.amount_hbar, 8)} released to ${c.freelancer.display_name}`, tx: c.txs.find((t) => t.kind === "SUBMIT_VERDICT")?.tx_hash };
  if (c.status === "HELD") return { message: c.hold_reason === "EVALUATION_ERROR" ? "No verdict — held for review" : "Verdict: fail — held for review" };
  if (c.status === "ERROR") return { message: `Paused at ${STEP[c.error?.step ?? ""] ?? c.error?.step}: ${c.error?.message?.slice(0, 120) ?? ""}`, error: true };
  return null;
}

export default function Toasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [offline, setOffline] = useState(false);
  const next = useRef(1);

  useEffect(() => {
    const push = (t: Omit<Toast, "id">) => {
      const id = next.current++;
      setToasts((ts) => [...ts, { ...t, id }]);
      if (!t.error) setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 5000);
    };
    const onToast = (e: Event) => push((e as CustomEvent).detail);
    const onStatus = (e: Event) => {
      const { contract, from } = (e as CustomEvent).detail as { contract: Contract; from?: string };
      const t = fromStatus(contract, from);
      if (t) push(t);
    };
    window.addEventListener("vte:toast", onToast);
    window.addEventListener("vte:status", onStatus);
    setOffline(isOffline());
    const off = onOfflineChange(setOffline);
    return () => {
      window.removeEventListener("vte:toast", onToast);
      window.removeEventListener("vte:status", onStatus);
      off();
    };
  }, []);

  return (
    <>
      {offline && <div className="offline-bar" role="alert" data-testid="offline-bar">Backend offline — polling paused, retrying…</div>}
      <div className="toasts" aria-live="polite" data-testid="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.error ? "error" : ""}`} data-testid="toast">
            <span>
              {t.message}
              {t.tx && <> <HashPill kind="evmtx" id={t.tx} /></>}
              {t.hcsTx && <> <a href={hashscanUrl("transaction", t.hcsTx)} target="_blank" rel="noreferrer">↗</a></>}
            </span>
            <button className="x" aria-label="Dismiss" onClick={() => setToasts((ts) => ts.filter((x) => x.id !== t.id))}>×</button>
          </div>
        ))}
      </div>
    </>
  );
}
