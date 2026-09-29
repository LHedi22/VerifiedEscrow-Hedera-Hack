"use client";

import { useEffect, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import EvaluationSection from "@/components/EvaluationSection";
import HashPill from "@/components/HashPill";
import Modal from "@/components/Modal";
import OnChainPanel from "@/components/OnChainPanel";
import { usePersona } from "@/components/Providers";
import StatusBadge from "@/components/StatusBadge";
import Stepper from "@/components/Stepper";
import Timeline from "@/components/Timeline";
import { ACTIVE, api, ApiError, type Contract, type Evaluation, type Health, publicFetcher, TERMINAL } from "@/lib/api";
import { SAMPLES } from "@/lib/demo";
import { codePoints, hbar } from "@/lib/format";

const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE !== "0"; // FR-31 Insert-sample menu (P1)
const STEP_NAME: Record<string, string> = {
  EVALUATING: "Evaluating", ANCHORING: "Anchoring", CONFIRMING: "Confirming", SUBMITTING_VERDICT: "Verdict",
};

function errMessage(e: unknown): string {
  if (e instanceof ApiError) return e.details?.reason ? `${e.message} (${e.details.reason})` : e.message;
  return String(e);
}

/** Tiny markdown preview: headings, bold, paragraphs. Display only. */
function Preview({ text }: { text: string }) {
  const bold = (s: string) => s.split(/(\*\*[^*]+\*\*)/).map((p, i) => (p.startsWith("**") && p.endsWith("**") ? <strong key={i}>{p.slice(2, -2)}</strong> : p));
  return (
    <div className="md-preview">
      {text.split(/\n{2,}/).map((block, i) => {
        const m = block.match(/^(#{1,3})\s+(.*)$/);
        if (m) {
          const H = (`h${m[1].length + 1}`) as "h2" | "h3" | "h4";
          return <H key={i}>{bold(m[2])}</H>;
        }
        return <p key={i}>{block.split("\n").map((l, j) => <span key={j}>{j > 0 && <br />}{bold(l)}</span>)}</p>;
      })}
    </div>
  );
}

function VerdictCard({ c, ev }: { c: Contract; ev: Evaluation | undefined }) {
  const persona = usePersona();
  const verdict = ev?.available ? ev.verdict : undefined;
  const evalError = c.hold_reason === "EVALUATION_ERROR" || (ev?.available && ev.reasoning.startsWith("EVALUATION_ERROR:"));
  const resolveTx = c.txs.find((t) => t.kind === "RESOLVE_DISPUTE");
  const verdictTx = c.txs.find((t) => t.kind === "SUBMIT_VERDICT");
  if (c.status === "RELEASED") {
    const byArbitrator = !!resolveTx;
    return (
      <div className="vcard pass" data-testid="verdict-card" data-card="released">
        <div className="vcard-title">{byArbitrator ? `Released by the arbitrator — ${hbar(c.amount_hbar, 8)} to ${c.freelancer.display_name}` : `PASS — ${hbar(c.amount_hbar, 8)} released`}</div>
        <div className="row">
          {persona === "freelancer" && <strong>Payment received</strong>}
          <span className="muted">Release tx</span> <HashPill kind="evmtx" id={(resolveTx ?? verdictTx)?.tx_hash} />
        </div>
      </div>
    );
  }
  if (c.status === "HELD") {
    return (
      <div className="vcard held" data-testid="verdict-card" data-card="held">
        <div className="vcard-title">{evalError ? "Evaluator couldn't produce a verdict — held for review" : "FAIL — held for arbitrator review"}</div>
        <div className="row">
          {persona === "freelancer" && <span>An arbitrator will review this.</span>}
          {persona === "arbitrator" && evalError && <span>The evaluator couldn&apos;t produce a verdict: judge the deliverable directly.</span>}
          <span className="muted">Verdict tx</span> <HashPill kind="evmtx" id={verdictTx?.tx_hash} />
        </div>
      </div>
    );
  }
  if (c.status === "REFUNDED") {
    return (
      <div className="vcard refunded" data-testid="verdict-card" data-card="refunded">
        <div className="vcard-title">Refunded to client — {hbar(c.amount_hbar, 8)} back to {c.client.display_name}</div>
        <div className="row"><span className="muted">Refund tx</span> <HashPill kind="evmtx" id={resolveTx?.tx_hash} /></div>
      </div>
    );
  }
  if (c.status === "ERROR") return null; // rendered by ErrorCard (needs Retry)
  return null;
}

export default function ContractDetail({ id }: { id: number }) {
  const persona = usePersona();
  const { mutate: globalMutate } = useSWRConfig();
  const { data: c, error, mutate } = useSWR<Contract>(`/contracts/${id}`, {
    refreshInterval: (d) => (d && ACTIVE.includes(d.status) ? 1500 : 4000),
  });
  const confirmed = !!c?.anchor?.confirmed;
  const { data: ev } = useSWR<Evaluation>(confirmed ? `/contracts/${id}/evaluation` : null, {
    refreshInterval: (d) => (d?.available ? 0 : 1500),
  });
  const { data: health } = useSWR<Health>("/health", publicFetcher, { refreshInterval: 10_000 });

  const [modal, setModal] = useState<null | "fund" | "submit" | "release" | "refund">(null);
  const [busy, setBusy] = useState(false);
  const [modalErr, setModalErr] = useState<React.ReactNode>(null);
  const [content, setContent] = useState("");
  const [tab, setTab] = useState<"write" | "preview">("write");
  const [sampleOpen, setSampleOpen] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryErr, setRetryErr] = useState<string | null>(null);

  // Header balances re-fetch when the contract is funded or reaches a terminal status (App Flow §2, TRD §11).
  const prev = useRef<string | undefined>();
  useEffect(() => {
    if (!c) return;
    if (prev.current && prev.current !== c.status && (c.status === "FUNDED" || TERMINAL.includes(c.status))) {
      globalMutate("/personas");
    }
    if (prev.current !== c.status) {
      window.dispatchEvent(new CustomEvent("vte:status", { detail: { contract: c, from: prev.current } }));
    }
    prev.current = c.status;
  }, [c, globalMutate]);

  if (error && !c) return <div className="card">{error instanceof ApiError && error.status === 404 ? `Contract ${id} not found.` : `Couldn't load contract ${id}: ${error.message}`}</div>;
  if (!c) return <div className="card"><span className="spinner" /> Loading…</div>;

  const close = () => { if (!busy) { setModal(null); setModalErr(null); } };
  async function act(fn: () => Promise<unknown>, onError?: (e: unknown) => React.ReactNode) {
    setBusy(true);
    setModalErr(null);
    try {
      await fn();
      await mutate();
      globalMutate("/personas");
      setModal(null);
    } catch (e) {
      setModalErr(onError ? onError(e) : errMessage(e));
      mutate();
    } finally {
      setBusy(false);
    }
  }

  const fund = () => act(
    async () => {
      const out = await api<Contract>(`/contracts/${id}/fund`, { method: "POST" });
      window.dispatchEvent(new CustomEvent("vte:toast", {
        detail: { message: `${hbar(out.amount_hbar, 8)} locked in escrow #${out.escrow_id}`, tx: out.txs.find((t) => t.kind === "CREATE_ESCROW")?.tx_hash },
      }));
    },
    (e) => (
      <>
        {errMessage(e)}
        {(!(e instanceof ApiError) || e.status === 0 || e.status >= 500) && (
          <div style={{ marginTop: 6 }}><strong>Check HashScan before retrying so you don&apos;t create two escrows.</strong></div>
        )}
      </>
    ),
  );
  const submit = () => act(async () => {
    await api(`/contracts/${id}/deliverable`, { method: "POST", body: JSON.stringify({ content }) });
    window.dispatchEvent(new CustomEvent("vte:toast", { detail: { message: "Submitted — evaluation started" } }));
  });
  const resolve = (release: boolean) => act(async () => {
    const out = await api<Contract>(`/contracts/${id}/resolve`, { method: "POST", body: JSON.stringify({ release }) });
    window.dispatchEvent(new CustomEvent("vte:toast", {
      detail: { message: `Dispute resolved: ${release ? "released" : "refunded"}`, tx: out.txs.find((t) => t.kind === "RESOLVE_DISPUTE")?.tx_hash },
    }));
  });
  async function retry() {
    setRetrying(true);
    setRetryErr(null);
    try {
      await api(`/contracts/${id}/retry`, { method: "POST" });
      await mutate();
    } catch (e) {
      setRetryErr(errMessage(e));
    } finally {
      setRetrying(false);
    }
  }

  const len = codePoints(content);
  const evaluatorOffline = health ? health.ollama !== "ok" : false;
  const evAvail = ev?.available ? ev : undefined;
  const showEvaluation = !!evAvail && (c.status !== "ERROR" || confirmed);
  const isMine = (role: string) => persona === role;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="row" style={{ gap: 12 }}>
            <h1 data-testid="contract-title">{c.title}</h1>
            <StatusBadge status={c.status} />
            {c.disputed && <span className="chip amber">Disputed</span>}
          </div>
          <div className="muted">
            Client <strong>{c.client.display_name}</strong> → Freelancer <strong>{c.freelancer.display_name}</strong> · Arbitrator {c.arbitrator.display_name} ·{" "}
            <strong className="mono">{hbar(c.amount_hbar, 8)}</strong> <span className="small">· #{c.id}</span>
          </div>
        </div>
      </div>

      <div className="detail-grid">
        <div className="stack">
          <section className="card"><Stepper c={c} /></section>

          <VerdictCard c={c} ev={ev} />

          {c.status === "ERROR" && c.error && (
            <div className="vcard error" data-testid="error-card">
              <div className="vcard-title">Paused at {STEP_NAME[c.error.step] ?? c.error.step}</div>
              <p className="mono small" style={{ margin: "4px 0 12px", wordBreak: "break-word" }}>{c.error.message}</p>
              <div className="row">
                <button className="btn primary" onClick={retry} disabled={retrying} data-testid="retry">
                  {retrying && <span className="spinner" />} Retry
                </button>
                {retryErr && <span className="err-text">{retryErr}</span>}
              </div>
            </div>
          )}

          {/* Actions by persona × state (App Flow §5.3) */}
          {c.status === "DRAFT" && (
            isMine("client") ? (
              <div className="card action-card">
                <div><strong>Lock {hbar(c.amount_hbar, 8)} in a new escrow</strong><div className="muted small">This sends a testnet transaction from your account.</div></div>
                <button className="btn primary lg" onClick={() => setModal("fund")} data-testid="fund">Fund escrow</button>
              </div>
            ) : <div className="card muted">{isMine("freelancer") ? "Waiting for the client to fund." : "Draft — nothing to review yet."}</div>
          )}

          {c.status === "FUNDED" && (
            isMine("freelancer") ? (
              <section className="card" data-testid="deliverable-editor">
                <div className="row" style={{ marginBottom: 10 }}>
                  <h2 style={{ margin: 0 }}>Deliverable</h2>
                  <div className="tabs">
                    <button className={tab === "write" ? "on" : ""} onClick={() => setTab("write")}>Write</button>
                    <button className={tab === "preview" ? "on" : ""} onClick={() => setTab("preview")}>Preview</button>
                  </div>
                  <span className="spacer" />
                  {DEMO_MODE && (
                    <div className="menu-wrap">
                      <button className="btn" onClick={() => setSampleOpen(!sampleOpen)} data-testid="insert-sample">Insert sample ▾</button>
                      {sampleOpen && (
                        <div className="menu">
                          <button onClick={() => { setContent(SAMPLES.good); setSampleOpen(false); setTab("write"); }} data-testid="sample-good">Good (meets every requirement)</button>
                          <button onClick={() => { setContent(SAMPLES.weak); setSampleOpen(false); setTab("write"); }} data-testid="sample-weak">Weak (misses one requirement)</button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                {tab === "write" ? (
                  <textarea className="input mono" rows={14} value={content} onChange={(e) => setContent(e.target.value)}
                            placeholder="Paste or write the deliverable (markdown)…" data-testid="deliverable" />
                ) : <Preview text={content} />}
                <div className="row" style={{ marginTop: 10 }}>
                  <span className={`small ${len > 8000 ? "err-text" : "muted"}`}>{len.toLocaleString()}/8,000 characters</span>
                  <span className="spacer" />
                  <span title={evaluatorOffline ? "Evaluator offline" : undefined}>
                    <button className="btn primary lg" disabled={len < 1 || len > 8000 || evaluatorOffline}
                            onClick={() => setModal("submit")} data-testid="submit">Submit for evaluation</button>
                  </span>
                </div>
                {evaluatorOffline && <div className="hint"><span className="err">Evaluator offline</span></div>}
              </section>
            ) : <div className="card muted" data-testid="waiting">{isMine("client") ? "Waiting for the deliverable." : "Funded — waiting for the deliverable."}</div>
          )}

          {c.status === "HELD" && isMine("arbitrator") && (
            <div className="card action-card" data-testid="resolve-actions">
              <div><strong>Your decision</strong><div className="muted small">Verify the record first, then judge the anchored version.</div></div>
              <div className="row">
                <button className="btn success lg" onClick={() => setModal("release")} data-testid="release">Release to freelancer</button>
                <button className="btn danger lg" onClick={() => setModal("refund")} data-testid="refund">Refund client</button>
              </div>
            </div>
          )}

          {showEvaluation && evAvail && <EvaluationSection ev={evAvail} submitting={c.status === "SUBMITTING_VERDICT"} />}
          {ACTIVE.includes(c.status) && c.status !== "SUBMITTING_VERDICT" && (
            <div className="card muted small" data-testid="verdict-hidden">The verdict stays hidden until the record is anchored on Hedera and confirmed by the mirror node.</div>
          )}

          <details className="card" open={c.status === "DRAFT" || c.status === "FUNDED"}>
            <summary><strong>Statement of Work</strong></summary>
            <pre className="doc">{c.sow}</pre>
          </details>
          {c.deliverable && (
            <details className="card">
              <summary><strong>Deliverable</strong> <span className="muted small">submitted {new Date(c.deliverable.submitted_at).toLocaleString("en-GB")}</span></summary>
              <pre className="doc">{c.deliverable.content}</pre>
            </details>
          )}
          <section className="card">
            <h2>Timeline</h2>
            <Timeline events={c.timeline} />
          </section>
        </div>
        <OnChainPanel c={c} />
      </div>

      {modal === "fund" && (
        <Modal title="Fund escrow" confirmLabel="Lock funds" onClose={close} onConfirm={fund} busy={busy} error={modalErr} testid="modal-fund">
          <dl className="kv">
            <dt>Amount</dt><dd className="mono">{hbar(c.amount_hbar, 8)}</dd>
            <dt>Freelancer</dt><dd>{c.freelancer.display_name} <span className="muted mono small">{c.freelancer.account_id}</span></dd>
            <dt>Arbitrator</dt><dd>{c.arbitrator.display_name} <span className="muted mono small">{c.arbitrator.account_id}</span></dd>
          </dl>
          <p className="muted">Lock {hbar(c.amount_hbar, 8)} in a new escrow — this sends a testnet transaction.</p>
        </Modal>
      )}
      {modal === "submit" && (
        <Modal title="Submit deliverable" confirmLabel="Submit" onClose={close} onConfirm={submit} busy={busy} error={modalErr} testid="modal-submit">
          <p><strong>One submission only.</strong> The AI verdict will be anchored on Hedera before anyone sees it.</p>
          <p className="muted">{len.toLocaleString()} characters.</p>
        </Modal>
      )}
      {(modal === "release" || modal === "refund") && (
        <Modal title="Resolve" confirmLabel="Confirm" danger={modal === "refund"} onClose={close} onConfirm={() => resolve(modal === "release")}
               busy={busy} error={modalErr} testid="modal-resolve">
          <p><strong>{modal === "release" ? `Release ${hbar(c.amount_hbar, 8)} to ${c.freelancer.display_name}` : `Refund ${hbar(c.amount_hbar, 8)} to ${c.client.display_name}`}</strong></p>
          <p className="muted">
            Verify the record first{c.escrow_id !== null && <> (<a href={`/verify/${c.escrow_id}`} target="_blank" rel="noreferrer">open verification ↗</a>)</>}.
            On a mismatch, judge the anchored record, not the app&apos;s copy.
          </p>
        </Modal>
      )}
    </>
  );
}
