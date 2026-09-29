"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import useSWR from "swr";
import { usePersona } from "@/components/Providers";
import StatusBadge from "@/components/StatusBadge";
import { ACTIVE, type ContractSummary, type Role, type Status } from "@/lib/api";
import { hbar, timeAgo } from "@/lib/format";
import { ROLE_LABEL } from "@/lib/persona";

// App Flow §5.1.
const FILTERS: { key: string; label: string; match: (s: Status) => boolean }[] = [
  { key: "all", label: "All", match: () => true },
  { key: "active", label: "Active", match: (s) => s === "DRAFT" || s === "FUNDED" || ACTIVE.includes(s) || s === "ERROR" },
  { key: "held", label: "Held", match: (s) => s === "HELD" },
  { key: "closed", label: "Closed", match: (s) => s === "RELEASED" || s === "REFUNDED" },
];

function counterparty(c: ContractSummary, persona: Role): string {
  if (persona === "client") return c.freelancer.display_name;
  if (persona === "freelancer") return c.client.display_name;
  return `${c.client.display_name} → ${c.freelancer.display_name}`;
}

function Empty({ persona }: { persona: Role }) {
  if (persona === "client")
    return (
      <div className="empty">
        No contracts yet. Create one to lock funds in escrow.
        <br />
        <Link className="btn primary" href="/contracts/new">+ New contract</Link>
      </div>
    );
  if (persona === "freelancer") return <div className="empty">No contracts assigned to you yet.</div>;
  return (
    <div className="empty">
      Nothing to review. <Link href="/arbitration">Arbitration</Link>
    </div>
  );
}

export default function Dashboard() {
  const persona = usePersona();
  const router = useRouter();
  const [filter, setFilter] = useState("all");
  const { data, error } = useSWR<{ items: ContractSummary[]; total: number }>("/contracts?mine=true", { refreshInterval: 5000 });
  const f = FILTERS.find((x) => x.key === filter)!;
  const items = data?.items.filter((c) => f.match(c.status)) ?? [];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Your contracts</h1>
          <span className="chip">{ROLE_LABEL[persona]}</span>
        </div>
        <span className="spacer" />
        {persona === "client" && <Link className="btn primary" href="/contracts/new">+ New contract</Link>}
      </div>

      <div className="row" style={{ marginBottom: 14 }}>
        <div className="filters" role="tablist">
          {FILTERS.map((x) => (
            <button key={x.key} role="tab" aria-selected={filter === x.key} className={`filter ${filter === x.key ? "on" : ""}`}
                    onClick={() => setFilter(x.key)} data-testid={`filter-${x.key}`}>
              {x.label}
              {data && <span className="muted"> {data.items.filter((c) => x.match(c.status)).length}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="card flush">
        {error && !data ? (
          <div className="empty">Couldn&apos;t load contracts ({error.message}).</div>
        ) : !data ? (
          <div className="empty"><span className="spinner" /></div>
        ) : data.items.length === 0 ? (
          <Empty persona={persona} />
        ) : items.length === 0 ? (
          <div className="empty">No contracts in this view.</div>
        ) : (
          <table className="list" data-testid="contracts-table">
            <thead>
              <tr>
                <th>ID</th><th>Escrow #</th><th>Title</th>
                <th>{persona === "arbitrator" ? "Client → Freelancer" : "Counterparty"}</th>
                <th style={{ textAlign: "right" }}>Amount</th><th>Status</th><th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id} className="clickable" onClick={() => router.push(`/contracts/${c.id}`)} data-id={c.id}>
                  <td className="mono">{c.id}</td>
                  <td className="mono">{c.escrow_id ?? "—"}</td>
                  <td>
                    <Link href={`/contracts/${c.id}`} onClick={(e) => e.stopPropagation()} style={{ color: "inherit", fontWeight: 600 }}>{c.title}</Link>
                    {c.disputed && <span className="chip amber" style={{ marginLeft: 8 }}>Disputed</span>}
                  </td>
                  <td>{counterparty(c, persona)}</td>
                  <td className="mono" style={{ textAlign: "right" }}>{hbar(c.amount_hbar, 8)}</td>
                  <td><StatusBadge status={c.status} /></td>
                  <td className="muted small">{timeAgo(c.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
