"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import useSWR from "swr";
import { usePersona } from "@/components/Providers";
import { api, ApiError, type Contract, type Persona } from "@/lib/api";
import { S1 } from "@/lib/demo";
import { codePoints, hbar } from "@/lib/format";

// App Flow §5.2. Validation mirrors the API (Schema §5.3); the API is authoritative.
const AMOUNT_RE = /^\d+(\.\d{1,8})?$/;
const FEE_MARGIN = 2;

export default function NewContract() {
  const persona = usePersona();
  const router = useRouter();
  const { data: personas } = useSWR<Persona[]>("/personas");
  const [title, setTitle] = useState("");
  const [sow, setSow] = useState("");
  const [amount, setAmount] = useState("");
  const [freelancer, setFreelancer] = useState("freelancer");
  const [arbitrator, setArbitrator] = useState("arbitrator");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const dirty = !!(title || sow || amount);
  useEffect(() => {
    if (!dirty || busy) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, busy]);

  if (persona !== "client")
    return <div className="card">Only the client can create contracts. Switch persona to <strong>Client</strong>.</div>;

  const balance = Number(personas?.find((p) => p.role === "client")?.balance_hbar ?? NaN);
  const titleLen = codePoints(title.trim());
  const sowLen = codePoints(sow);
  const errors = {
    title: titleLen < 1 ? "Required" : titleLen > 120 ? "At most 120 characters" : null,
    sow: sowLen < 50 ? "At least 50 characters" : sowLen > 4000 ? "At most 4,000 characters" : null,
    amount: !AMOUNT_RE.test(amount) ? "A number with up to 8 decimals"
      : Number(amount) <= 0 ? "Must be more than 0"
      : Number(amount) > 100 ? "At most 100 ℏ"
      : Number.isFinite(balance) && Number(amount) > balance - FEE_MARGIN ? `At most your balance minus ${FEE_MARGIN} ℏ for fees (${hbar(String(balance - FEE_MARGIN))})`
      : null,
    parties: arbitrator === freelancer || arbitrator === "client" || freelancer === "client" ? "Client, freelancer and arbitrator must be different" : null,
  };
  const valid = !Object.values(errors).some(Boolean);
  const show = (k: keyof typeof errors) => (touched ? errors[k] : null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!valid) return;
    setBusy(true);
    setErr(null);
    try {
      const c = await api<Contract>("/contracts", {
        method: "POST",
        body: JSON.stringify({ title: title.trim(), sow, amount_hbar: amount, freelancer_role: freelancer, arbitrator_role: arbitrator }),
      });
      window.dispatchEvent(new CustomEvent("vte:toast", { detail: { message: "Draft saved" } }));
      router.push(`/contracts/${c.id}`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
      setBusy(false);
    }
  }

  const options = (role: string) => personas?.filter((p) => p.role !== "client").map((p) => (
    <option key={p.role} value={p.role}>{p.display_name} ({p.role}) · {p.account_id}</option>
  )) ?? <option value={role}>{role}</option>;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>New contract</h1>
          <span className="muted">The amount is locked in escrow when you fund it. An AI checks the work against this SOW.</span>
        </div>
      </div>
      <div className="new-grid">
        <form className="card stack" onSubmit={submit} noValidate>
          <div className="row">
            <span className="spacer" />
            <button type="button" className="btn" data-testid="use-example"
                    onClick={() => { setTitle(S1.title); setSow(S1.sow); setAmount(S1.amount_hbar); }}>
              Use example SOW
            </button>
          </div>
          <label className="field">
            <span className="label">Title</span>
            <input className={`input ${show("title") ? "invalid" : ""}`} value={title} onChange={(e) => setTitle(e.target.value)}
                   maxLength={200} data-testid="title" />
            <span className="hint"><span>{titleLen}/120</span>{show("title") && <span className="err">{show("title")}</span>}</span>
          </label>
          <label className="field">
            <span className="label">Statement of Work</span>
            <textarea className={`input ${show("sow") ? "invalid" : ""}`} rows={11} value={sow} onChange={(e) => setSow(e.target.value)}
                      placeholder="What must the deliverable contain?" data-testid="sow" />
            <span className="hint"><span>{sowLen.toLocaleString()}/4,000 characters</span>{show("sow") && <span className="err">{show("sow")}</span>}</span>
          </label>
          <div className="row" style={{ alignItems: "flex-start", gap: 16 }}>
            <label className="field" style={{ width: 200 }}>
              <span className="label">Amount</span>
              <span className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                <input className={`input mono ${show("amount") ? "invalid" : ""}`} inputMode="decimal" value={amount}
                       onChange={(e) => setAmount(e.target.value.trim())} placeholder="5" data-testid="amount" />
                <strong>ℏ</strong>
              </span>
            </label>
            <label className="field" style={{ flex: 1 }}>
              <span className="label">Freelancer</span>
              <select className="input" value={freelancer} onChange={(e) => setFreelancer(e.target.value)}>{options("freelancer")}</select>
            </label>
            <label className="field" style={{ flex: 1 }}>
              <span className="label">Arbitrator</span>
              <select className="input" value={arbitrator} onChange={(e) => setArbitrator(e.target.value)}>{options("arbitrator")}</select>
            </label>
          </div>
          {show("amount") && <div className="hint"><span className="err">{show("amount")}</span></div>}
          {show("parties") && <div className="hint"><span className="err">{show("parties")}</span></div>}
          {err && <div className="form-error">{err}</div>}
          <div className="row">
            <span className="muted small">Your balance: {Number.isFinite(balance) ? hbar(String(balance)) : "…"}</span>
            <span className="spacer" />
            <button className="btn primary lg" disabled={busy || (touched && !valid)} data-testid="create-draft">
              {busy && <span className="spinner" />} Create draft
            </button>
          </div>
        </form>
        <aside className="card helper">
          <p className="section-title">Writing a checkable SOW</p>
          <p>Write requirements the AI can check by reading the text, e.g. &lsquo;includes a pricing section&rsquo;, &lsquo;mentions the delivery date&rsquo;.</p>
          <p style={{ marginBottom: 0 }}>Avoid word counts: the local model can&apos;t count reliably.</p>
        </aside>
      </div>
    </>
  );
}
