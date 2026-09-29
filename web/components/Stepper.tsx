"use client";

import { useEffect, useState } from "react";
import { hashscanUrl } from "canonical";
import type { Contract, Status, TimelineEvent } from "@/lib/api";
import { consensusTime } from "@/lib/format";

// App Flow §5.3 status stepper (FR-16). The active step shows a spinner and an elapsed-time counter, so the
// demo reads as live work, not a hang.
type StepDef = { key: string; status?: Status; label: string; active: string; startedBy: string[]; doneBy: string[] };

const STEPS: StepDef[] = [
  { key: "funded", label: "Funded", active: "Funding…", startedBy: [], doneBy: ["funded"] },
  { key: "evaluating", status: "EVALUATING", label: "Evaluating", active: "AI is reading the SOW and deliverable…", startedBy: ["submitted"], doneBy: ["evaluated"] },
  { key: "anchoring", status: "ANCHORING", label: "Anchoring", active: "Writing the record to Hedera Consensus Service…", startedBy: ["evaluated"], doneBy: ["anchored"] },
  { key: "confirming", status: "CONFIRMING", label: "Confirming", active: "Waiting for consensus via the public mirror node…", startedBy: ["anchored"], doneBy: ["confirmed"] },
  { key: "verdict", status: "SUBMITTING_VERDICT", label: "Verdict", active: "Submitting verdict to the escrow contract…", startedBy: ["confirmed"], doneBy: ["released", "held", "reconciled"] },
  { key: "outcome", label: "Paid / Held", active: "", startedBy: [], doneBy: [] },
];
const INDEX: Partial<Record<Status, number>> = {
  DRAFT: -1, FUNDED: 0, EVALUATING: 1, ANCHORING: 2, CONFIRMING: 3, SUBMITTING_VERDICT: 4, RELEASED: 5, HELD: 5, REFUNDED: 5,
};
const SLOW_S = 30;

export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

const t = (e: TimelineEvent | undefined) => (e ? new Date(e.created_at).getTime() : undefined);
const last = (tl: TimelineEvent[], kinds: string[]) => [...tl].reverse().find((e) => kinds.includes(e.kind));

function secs(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** When a step (last) started: its trigger event, or a retry that resumed it. */
const stepStart = (tl: TimelineEvent[], s: StepDef) => t(last(tl, [...s.startedBy, "retried"]));

/** Step timings from the timeline; also used for the T3.8 report. */
export function stepDurations(tl: TimelineEvent[]): Record<string, number | undefined> {
  const out: Record<string, number | undefined> = {};
  for (const s of STEPS.slice(1, 5)) {
    const start = stepStart(tl, s);
    const end = t(last(tl, s.doneBy));
    out[s.key] = start !== undefined && end !== undefined && end >= start ? end - start : undefined;
  }
  return out;
}

export default function Stepper({ c }: { c: Contract }) {
  const now = useNow();
  const tl = c.timeline;
  const paused = c.status === "ERROR";
  const current = paused ? INDEX[c.error!.step] ?? 1 : INDEX[c.status] ?? -1;
  const terminal = ["RELEASED", "HELD", "REFUNDED"].includes(c.status);
  const outcomeLabel = c.status === "RELEASED" ? "Released" : c.status === "REFUNDED" ? "Refunded" : c.status === "HELD" ? "Held for review" : "Paid / Held";

  function doneLabel(s: StepDef): React.ReactNode {
    const a = c.anchor;
    switch (s.key) {
      case "funded": return c.escrow_id !== null ? `Funded · escrow #${c.escrow_id}` : "Funded";
      case "evaluating": return "Evaluated";
      case "anchoring":
        return a ? (
          <a href={hashscanUrl("transaction", a.tx_id)} target="_blank" rel="noreferrer" data-testid="anchored-link">
            Anchored · msgs #{a.sequence_first}–{a.sequence_last} ↗
          </a>
        ) : "Anchored";
      case "confirming": return a?.consensus_timestamp ? `Confirmed at ${consensusTime(a.consensus_timestamp)}` : "Confirmed";
      case "verdict": return "Verdict on-chain";
      default: return outcomeLabel;
    }
  }

  const durations = stepDurations(tl);
  const reused = tl.some((e) => e.kind === "criteria_reused");
  // Criteria sub-step (TRD §8.1 fallback 1): shown under Funded while waiting for work, and under Evaluating.
  const criteriaLine = c.criteria_ready
    ? <span className="substep ready" data-testid="criteria-substep" data-ready="true">✓ Criteria ready{reused ? " (reused from an identical SOW)" : ""}</span>
    : <span className="substep" data-testid="criteria-substep" data-ready="false"><span className="spinner" style={{ width: 11, height: 11 }} /> Reading the SOW…</span>;
  return (
    <ol className="stepper" data-testid="stepper" data-status={c.status}>
      {STEPS.map((s, i) => {
        const done = terminal ? true : i < current || (c.status === "FUNDED" && i === 0);
        const active = !terminal && !paused && i === current && i > 0;
        const isPaused = paused && i === current;
        const started = stepStart(tl, s);
        const took = durations[s.key];
        const elapsed = active && started ? now - started : undefined;
        const state = isPaused ? "paused" : active ? "active" : done ? "done" : "todo";
        const final = s.key === "outcome" ? (c.status === "HELD" ? "held" : c.status === "REFUNDED" ? "refunded" : "") : "";
        return (
          <li key={s.key} className={`step ${state} ${final}`} data-step={s.key} data-state={state}>
            <span className="step-dot" aria-hidden>{isPaused ? "!" : done ? "✓" : active ? <span className="spinner" /> : i + 1}</span>
            <div className="step-body">
              <div className="step-label">{done && s.key === "outcome" ? outcomeLabel : s.label}</div>
              <div className="step-sub">
                {isPaused && <span className="err-text">Paused · {c.error?.message?.slice(0, 80)}</span>}
                {active && (
                  <>
                    {s.key === "evaluating" && !c.criteria_ready ? "Reading the SOW…" : s.active}
                    {s.key === "confirming" && elapsed !== undefined && elapsed > SLOW_S * 1000 && " …taking longer than usual"}
                    {elapsed !== undefined && <span className="elapsed mono" data-testid="elapsed"> {secs(elapsed)}</span>}
                    {s.key === "evaluating" && criteriaLine}
                  </>
                )}
                {done && !isPaused && (
                  <>
                    {doneLabel(s)}
                    {took !== undefined && <span className="muted mono step-took">{secs(took)}</span>}
                    {s.key === "funded" && c.status === "FUNDED" && criteriaLine}
                  </>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
