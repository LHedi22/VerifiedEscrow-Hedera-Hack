"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import HashPill from "@/components/HashPill";
import CopyButton from "@/components/CopyButton";
import { CONTRACT_ADDRESS, TOPIC_ID } from "@/lib/deployment";
import { consensusDate, consensusTime } from "@/lib/format";
import { type OracleChecks, type Outcome, type Step, type Verification, initialSteps, verify } from "@/lib/verify";

const ICON: Record<Step["state"], string> = { pending: "☐", running: "◌", ok: "☑", fail: "☒" };

function Checklist({ steps }: { steps: Step[] }) {
  return (
    <ul className="checklist" data-testid="checklist">
      {steps.map((s) => (
        <li key={s.key} className={s.state}>
          <span className="ck" aria-hidden>{s.state === "running" ? <span className="spinner" /> : ICON[s.state]}</span>
          <span>{s.label}</span>
          {s.detail && <span className="mono ck-detail">→ {s.detail}</span>}
        </li>
      ))}
    </ul>
  );
}

function Banner({ outcome, anchorTs, onRetry }: { outcome: Outcome; anchorTs?: string; onRetry: () => void }) {
  switch (outcome.kind) {
    case "loading":
      return <div className="vbanner neutral"><span className="spinner" /> Verifying…</div>;
    case "match":
      return (
        <div className="vbanner match" data-testid="verdict-banner" data-result="MATCH" role="status">
          <span className="vicon" aria-hidden>✅</span>
          <div>
            <strong>VERIFIED</strong> — the record shown matches the record anchored on Hedera at{" "}
            {consensusTime(anchorTs)}, before the verdict was revealed to anyone.
          </div>
        </div>
      );
    case "mismatch":
      return (
        <div className="vbanner mismatch" data-testid="verdict-banner" data-result="MISMATCH" role="alert">
          <span className="vicon" aria-hidden>⛔</span>
          <div><strong>TAMPERING DETECTED</strong> — the record shown by this app does not match the record anchored on Hedera.</div>
        </div>
      );
    case "not_anchored":
      return (
        <div className="vbanner neutral" data-result="NOT_ANCHORED">
          <span className="vicon" aria-hidden>⏳</span>
          <div>No anchored record yet — status: {outcome.status}.</div>
        </div>
      );
    case "found_on_hedera":
      return (
        <div className="vbanner neutral" data-testid="verdict-banner" data-result="FOUND_ON_HEDERA">
          <span className="vicon" aria-hidden>∅</span>
          <div>No contract found in this app — <strong>but Hedera holds an anchored record for this escrow</strong>. It is shown below, read straight from the topic.</div>
        </div>
      );
    case "multiple_records":
      return (
        <div className="vbanner mismatch" data-testid="verdict-banner" data-result="MULTIPLE_RECORDS" role="alert">
          <span className="vicon" aria-hidden>⛔</span>
          <div>
            <strong>Multiple different records anchored for this escrow</strong> ({outcome.hashes.length}).{" "}
            {outcome.authoritative
              ? <>The one matching the on-chain verdictHash (<code>{outcome.authoritative.slice(0, 4)}…{outcome.authoritative.slice(-4)}</code>) is authoritative.</>
              : "None of them matches the on-chain verdictHash."}
          </div>
        </div>
      );
    case "not_found":
      return (
        <div className="vbanner neutral" data-result="NOT_FOUND">
          <span className="vicon" aria-hidden>∅</span>
          <div>No contract found in this app.</div>
        </div>
      );
    case "wrong_escrow":
      return (
        <div className="vbanner mismatch" data-result="WRONG_ESCROW" role="alert">
          <span className="vicon" aria-hidden>⛔</span>
          <div>The backend pointed to a record for a different escrow (#{outcome.anchoredFor}).</div>
        </div>
      );
    case "unexpected_topic":
      return (
        <div className="vbanner mismatch" data-result="UNEXPECTED_TOPIC" role="alert">
          <span className="vicon" aria-hidden>⛔</span>
          <div>The backend points to an unexpected topic ({outcome.apiTopic}; this page checks {TOPIC_ID}).</div>
        </div>
      );
    case "unexpected_contract":
      return (
        <div className="vbanner mismatch" data-result="UNEXPECTED_CONTRACT" role="alert">
          <span className="vicon" aria-hidden>⛔</span>
          <div>The backend points to an unexpected escrow contract ({outcome.apiContract}).</div>
        </div>
      );
    case "unparseable":
      return (
        <div className="vbanner mismatch" data-result="UNPARSEABLE" role="alert">
          <span className="vicon" aria-hidden>⛔</span>
          <div>The anchored messages are not a valid record.</div>
        </div>
      );
    case "mirror_unreachable":
      return (
        <div className="vbanner offline" data-result="MIRROR_UNREACHABLE" role="alert">
          <span className="vicon" aria-hidden>⚠</span>
          <div>Couldn&apos;t reach Hedera mirror node — verification not possible.</div>
          <button className="btn" onClick={onRetry}>Retry</button>
        </div>
      );
    case "incomplete":
      return (
        <div className="vbanner offline" data-result="INCOMPLETE">
          <span className="vicon" aria-hidden>⚠</span>
          <div>Anchored record incomplete ({outcome.have} of {outcome.total} chunks) — retry in a few seconds.</div>
          <button className="btn" onClick={onRetry}>Retry</button>
        </div>
      );
    case "api_error":
      return (
        <div className="vbanner offline" data-result="API_ERROR" role="alert">
          <span className="vicon" aria-hidden>⚠</span>
          <div>Couldn&apos;t load the displayed record ({outcome.message}).</div>
          <button className="btn" onClick={onRetry}>Retry</button>
        </div>
      );
  }
}

const preview = (s: string | undefined, n = 220) => (s === undefined ? "(missing)" : s.length > n ? s.slice(0, n) + "…" : s);

function DiffTable({ outcome }: { outcome: Extract<Outcome, { kind: "mismatch" }> }) {
  return (
    <section className="card" data-testid="field-diff">
      <div className="row" style={{ marginBottom: 14, gap: 24 }}>
        <span>Displayed hash <code className="hash bad">{outcome.dbHash.slice(0, 4)}…{outcome.dbHash.slice(-4)}</code></span>
        <span>Anchored hash <code className="hash">{outcome.hcsHash.slice(0, 4)}…{outcome.hcsHash.slice(-4)}</code></span>
      </div>
      <h2>Field-by-field comparison</h2>
      <table className="diff">
        <thead>
          <tr><th>Field</th><th>Shown by app (DB)</th><th>Anchored on Hedera</th></tr>
        </thead>
        <tbody>
          {outcome.diff.map((r) => (
            <tr key={r.field} className={r.same ? "" : "changed"} data-field={r.field} data-changed={!r.same}>
              <td className="mono">{r.field}{!r.same && <span className="chip red" style={{ marginLeft: 8 }}>changed</span>}</td>
              {r.same ? (
                <td colSpan={2} className="muted">(identical)</td>
              ) : (
                <>
                  <td className="cell">{preview(r.db)}</td>
                  <td className="cell">{preview(r.hcs)}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ marginBottom: 0 }}><strong>The anchored version is the one produced at evaluation time. Judge that one.</strong></p>
    </section>
  );
}

function AnchoredRecord({ rec, dbContractId }: { rec: Record<string, string>; dbContractId?: number }) {
  const pass = rec.verdict === "pass";
  return (
    <section className="card" data-testid="anchored-record">
      <div className="row">
        <h2 style={{ margin: 0 }}>Anchored record <span className="muted" style={{ fontWeight: 400 }}>(from Hedera)</span></h2>
        <span className="spacer" />
        {dbContractId !== undefined && <Link className="btn" href={`/contracts/${dbContractId}`}>View contract</Link>}
      </div>
      <div className="row" style={{ margin: "14px 0", gap: 16 }}>
        <span className={`verdict-tag ${pass ? "pass" : "fail"}`} data-testid="anchored-verdict">Verdict {pass ? "PASS" : "FAIL"}</span>
        <span className="muted">Model</span> <code>{rec.model_version}</code>
        {rec.model_version?.startsWith("replay/") && <span className="chip" data-testid="replay-chip">Replayed verdict (demo fallback)</span>}
        <span className="muted">Timestamp</span> <code>{rec.timestamp}</code>
      </div>
      <h3>Reasoning</h3>
      <p className="reasoning" data-testid="anchored-reasoning">{rec.reasoning}</p>
      <details>
        <summary>Statement of Work</summary>
        <pre className="doc">{rec.sow}</pre>
      </details>
      <details>
        <summary>Deliverable</summary>
        <pre className="doc">{rec.deliverable}</pre>
      </details>
    </section>
  );
}

const mark = (ok: boolean | undefined) => (ok === undefined ? <span className="muted">—</span> : ok ? <span className="ok-mark">✓</span> : <span className="bad-mark">✗</span>);

/** "Escrow contract ✓ / HCS ✓ / App ✗" (App Flow §5.6, FR-25). */
function ConsistencyRow({ v }: { v: Verification }) {
  const o = v.outcome.kind === "multiple_records" ? v.outcome.base : v.outcome;
  const app = o.kind === "match" ? true : o.kind === "mismatch" ? false : undefined;
  const hcs = v.hcsHash ? true : ["mirror_unreachable", "incomplete", "unparseable", "wrong_escrow"].includes(o.kind) ? false : undefined;
  const contract = v.oracle?.all;
  return (
    <div className="consistency" data-testid="consistency-row"
         data-contract={String(contract)} data-hcs={String(hcs)} data-app={String(app)}>
      <span>Escrow contract {mark(contract)}</span>
      <span className="sep">/</span>
      <span>HCS {mark(hcs)}</span>
      <span className="sep">/</span>
      <span>App {mark(app)}</span>
    </div>
  );
}

function OracleDetail({ c }: { c: OracleChecks }) {
  const rows: [string, boolean][] = [
    ["verdictHash = anchored record hash", c.hash],
    ["verdictPassed = anchored verdict", c.verdict],
    ["sowHash = hash of anchored SOW", c.sow],
    ["escrow exists on-chain", c.exists],
  ];
  return (
    <ul className="oracle-checks" data-testid="oracle-checks">
      {rows.map(([label, ok]) => <li key={label} data-ok={ok}>{mark(ok)} {label}</li>)}
    </ul>
  );
}

function Evidence({ v, escrowId }: { v: Verification; escrowId: number }) {
  const chain = v.chain;
  const scan = v.scan;
  return (
    <aside className="card evidence" data-testid="evidence">
      <p className="section-title">Evidence</p>
      <ConsistencyRow v={v} />
      {v.oracle && <OracleDetail c={v.oracle} />}
      <dl>
        <dt>Topic <span className="muted small">(built into this page)</span></dt>
        <dd><HashPill kind="topic" id={TOPIC_ID} /></dd>
        <dt>HCS messages</dt>
        <dd>
          {v.anchor ? (
            <HashPill kind="transaction" id={v.anchor.tx_id}
                      label={`#${v.anchor.sequence_first}–${v.anchor.sequence_last} · ${v.anchor.chunk_count} chunk${v.anchor.chunk_count > 1 ? "s" : ""}`} />
          ) : "—"}
        </dd>
        <dt>Consensus timestamp</dt>
        <dd className="mono">{v.anchor?.consensusTimestamp ? consensusDate(v.anchor.consensusTimestamp) : "—"}</dd>
        <dt>Escrow</dt>
        <dd className="row" style={{ gap: 8 }}>
          <HashPill kind="contract" id={CONTRACT_ADDRESS} label={`#${escrowId} ↔ ${CONTRACT_ADDRESS.slice(0, 6)}…${CONTRACT_ADDRESS.slice(-4)}`} />
        </dd>
        <dt>On-chain status</dt>
        <dd data-testid="chain-status">
          {!chain ? <span className="muted">reading…</span> : "error" in chain ? <span className="muted">couldn&apos;t read ({chain.error})</span> : <strong>{chain.status}</strong>}
        </dd>
        <dt>Topic scan <span className="muted small">(no backend pointers)</span></dt>
        <dd data-testid="scan-count">
          {!scan ? <span className="muted">scanning…</span> : "error" in scan ? <span className="muted">couldn&apos;t scan ({scan.error})</span>
            : `${scan.length} distinct record${scan.length === 1 ? "" : "s"} for escrow #${escrowId}${scan.some((r) => r.copies > 1) ? " (identical resubmissions merged)" : ""}`}
        </dd>
        <dt>On-chain verdictHash</dt>
        <dd>
          {chain && !("error" in chain) ? (
            <span className="row" style={{ gap: 4 }}>
              <code className="hash">{chain.verdictHash.slice(0, 10)}…{chain.verdictHash.slice(-6)}</code>
              <CopyButton value={chain.verdictHash} />
            </span>
          ) : "—"}
        </dd>
      </dl>
    </aside>
  );
}

export default function VerifyResult({ escrowId }: { escrowId: number }) {
  const [v, setV] = useState<Verification>({ steps: initialSteps(), outcome: { kind: "loading" } });
  const [run, setRun] = useState(0);

  useEffect(() => {
    let live = true;
    setV({ steps: initialSteps(), outcome: { kind: "loading" } });
    verify(escrowId, (next) => live && setV(next));
    return () => { live = false; };
  }, [escrowId, run]);

  const o = v.outcome;
  return (
    <div className="verify">
      <div className="page-head">
        <div>
          <p className="section-title" style={{ marginBottom: 4 }}>Public verification</p>
          <h1>Escrow #{escrowId}</h1>
        </div>
        <span className="spacer" />
        <button className="btn" onClick={() => setRun((n) => n + 1)} disabled={o.kind === "loading"}>Re-run checks</button>
      </div>

      <Banner outcome={o} anchorTs={v.anchor?.consensusTimestamp} onRetry={() => setRun((n) => n + 1)} />

      <div className="verify-grid">
        <div className="stack">
          <section className="card"><Checklist steps={v.steps} /></section>
          {o.kind === "mismatch" && <DiffTable outcome={o} />}
          {o.kind === "multiple_records" && o.base.kind === "mismatch" && <DiffTable outcome={o.base} />}
          {v.hcsRecord && ["match", "mismatch", "multiple_records", "found_on_hedera"].includes(o.kind) && (
            <AnchoredRecord rec={v.hcsRecord} dbContractId={v.dbContractId} />
          )}
          {o.kind === "not_anchored" && v.dbContractId !== undefined && (
            <Link className="btn" href={`/contracts/${v.dbContractId}`}>View contract</Link>
          )}
        </div>
        <Evidence v={v} escrowId={escrowId} />
      </div>
    </div>
  );
}
