"use client";

import Link from "next/link";
import useSWR from "swr";
import { usePersona } from "@/components/Providers";
import type { ContractSummary } from "@/lib/api";
import { hbar, timeAgo } from "@/lib/format";

// App Flow §5.4. "Held since" = updated_at: a HELD row isn't written again until it is resolved.
export default function Arbitration() {
  const persona = usePersona();
  const { data, error } = useSWR<{ items: ContractSummary[]; total: number }>(
    persona === "arbitrator" ? "/contracts?status=HELD&mine=true" : null, { refreshInterval: 5000 },
  );
  if (persona !== "arbitrator")
    return <div className="card">The arbitration queue is for the arbitrator. Switch persona to <strong>Arbitrator</strong>.</div>;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Arbitration</h1>
          <span className="muted">Contracts held for your review. Verify the record before deciding.</span>
        </div>
      </div>
      <div className="card flush">
        {error && !data ? (
          <div className="empty">Couldn&apos;t load the queue ({error.message}).</div>
        ) : !data ? (
          <div className="empty"><span className="spinner" /></div>
        ) : data.items.length === 0 ? (
          <div className="empty" data-testid="arb-empty">No contracts held for review.</div>
        ) : (
          <table className="list" data-testid="arb-table">
            <thead>
              <tr><th>ID</th><th>Escrow #</th><th>Title</th><th>Client</th><th>Freelancer</th><th style={{ textAlign: "right" }}>Amount</th><th>Held since</th><th>Hold reason</th><th /></tr>
            </thead>
            <tbody>
              {data.items.map((c) => (
                <tr key={c.id} data-id={c.id}>
                  <td className="mono">{c.id}</td>
                  <td className="mono">{c.escrow_id}</td>
                  <td style={{ fontWeight: 600 }}>{c.title}</td>
                  <td>{c.client.display_name}</td>
                  <td>{c.freelancer.display_name}</td>
                  <td className="mono" style={{ textAlign: "right" }}>{hbar(c.amount_hbar, 8)}</td>
                  <td className="muted small">{timeAgo(c.updated_at)}</td>
                  <td>
                    <span className={`chip ${c.hold_reason === "EVALUATION_ERROR" ? "red" : "amber"}`} data-testid="hold-reason">{c.hold_reason}</span>
                  </td>
                  <td className="row" style={{ justifyContent: "flex-end", flexWrap: "nowrap" }}>
                    <Link className="btn" href={`/contracts/${c.id}`}>Review</Link>
                    <a className="btn" href={`/verify/${c.escrow_id}`} target="_blank" rel="noreferrer">Verify ↗</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
