"use client";

import type { Evaluation } from "@/lib/api";

type Ev = Extract<Evaluation, { available: true }>;

/** App Flow §5.3 "Evaluation section". Rendered only once /evaluation returns available: true (FR-11). */
export default function EvaluationSection({ ev, submitting }: { ev: Ev; submitting: boolean }) {
  const pass = ev.verdict === "pass";
  const error = ev.reasoning.startsWith("EVALUATION_ERROR:");
  const results = new Map((ev.results ?? []).map((r) => [r.id, r]));
  const conf = ev.confidence ?? 0;
  return (
    <section className="card" data-testid="evaluation">
      <div className="row">
        <h2 style={{ margin: 0 }}>Evaluation</h2>
        {submitting && <span className="chip" data-testid="submitting-tag"><span className="spinner" style={{ width: 12, height: 12 }} /> Submitting to escrow…</span>}
        <span className="spacer" />
        <span className="pill" title="model_version (anchored)">{ev.model_version}</span>
      </div>
      <div className="row" style={{ margin: "16px 0 10px", gap: 16 }}>
        <span className={`verdict-tag ${pass ? "pass" : "fail"}`} data-testid="eval-verdict">{error ? "NO VERDICT" : pass ? "PASS" : "FAIL"}</span>
        {ev.confidence !== null && (
          <span className="row" style={{ gap: 8 }}>
            <span className="muted small">Confidence</span>
            <span className="conf-bar"><span style={{ width: `${Math.round(conf * 100)}%` }} /></span>
            <span className="mono small">{conf.toFixed(2)}</span>
          </span>
        )}
        {ev.model_version.startsWith("replay/") && <span className="chip">Replayed verdict (demo fallback)</span>}
        {ev.injection_suspected && (
          <span className="chip amber" data-testid="injection-chip">Deliverable contained instructions aimed at the evaluator.</span>
        )}
      </div>
      <p className="reasoning" data-testid="eval-reasoning">{ev.reasoning}</p>
      {ev.criteria.length > 0 && (
        <>
          <div className="row" style={{ marginTop: 18, marginBottom: 8 }}>
            <h3 style={{ margin: 0 }}>Criteria</h3>
            <span className="chip" title="Schema §4.1: the verdict, reasoning, SOW and deliverable are anchored; this table is not">
              Not anchored in v1 — display only
            </span>
          </div>
          <table className="list criteria">
            <thead><tr><th>ID</th><th>Criterion</th><th>Required</th><th>Met</th><th>Evidence</th></tr></thead>
            <tbody>
              {ev.criteria.map((c) => {
                const r = results.get(c.id);
                return (
                  <tr key={c.id}>
                    <td className="mono">{c.id}</td>
                    <td>{c.description}</td>
                    <td>{c.required ? "Yes" : "No"}</td>
                    <td className={r ? (r.met ? "met" : "unmet") : "muted"}>{r ? (r.met ? "✓" : "✗") : "—"}</td>
                    <td>{r?.evidence ? <details><summary>{r.evidence.slice(0, 50)}{r.evidence.length > 50 ? "…" : ""}</summary>{r.evidence}</details> : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
