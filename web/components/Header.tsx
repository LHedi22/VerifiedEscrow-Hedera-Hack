"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import type { Persona, Role } from "@/lib/api";
import { hbar } from "@/lib/format";
import { ROLE_LABEL, ROLES, switchPersona } from "@/lib/persona";
import { usePersona } from "./Providers";

const NAV: Record<Role, { href: string; label: string; held?: boolean }[]> = {
  client: [{ href: "/", label: "Dashboard" }, { href: "/contracts/new", label: "+ New contract" }, { href: "/verify", label: "Verify" }],
  freelancer: [{ href: "/", label: "Dashboard" }, { href: "/verify", label: "Verify" }],
  arbitrator: [{ href: "/", label: "Dashboard" }, { href: "/arbitration", label: "Arbitration", held: true }, { href: "/verify", label: "Verify" }],
};

function Avatar({ p }: { p: { role: Role; display_name: string } }) {
  return <span className={`avatar ${p.role}`}>{p.display_name.slice(0, 1)}</span>;
}

function HeldCount() {
  const { data } = useSWR<{ total: number }>("/contracts?status=HELD&mine=true", { refreshInterval: 10_000 });
  return data && data.total > 0 ? <span className="count" data-testid="held-count">{data.total}</span> : null;
}

function PersonaSwitcher({ persona }: { persona: Role }) {
  // Balances are live (hedera-svc /accounts); re-fetched when a contract reaches a terminal status (App Flow §2).
  const { data: personas } = useSWR<Persona[]>("/personas", { refreshInterval: 30_000 });
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const me = personas?.find((p) => p.role === persona);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <div className="persona" ref={ref}>
      <button className="persona-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} data-testid="persona-btn">
        <Avatar p={me ?? { role: persona, display_name: ROLE_LABEL[persona] }} />
        <span>
          <span className="persona-name">{me?.display_name ?? "…"} <span className="muted">({ROLE_LABEL[persona]})</span></span>
          <br />
          <span className="persona-meta mono" data-testid="persona-balance">{me ? hbar(me.balance_hbar) : "loading…"}</span>
        </span>
        <span className="muted" aria-hidden>▾</span>
      </button>
      {open && (
        <div className="persona-menu" role="menu">
          {ROLES.map((role) => {
            const p = personas?.find((x) => x.role === role);
            return (
              <button key={role} role="menuitem" className={`persona-opt ${role === persona ? "current" : ""}`}
                      onClick={() => (role === persona ? setOpen(false) : switchPersona(role))} data-testid={`persona-${role}`}>
                <Avatar p={p ?? { role, display_name: ROLE_LABEL[role] }} />
                <span>
                  <strong>{p?.display_name ?? ROLE_LABEL[role]}</strong> <span className="muted">· {ROLE_LABEL[role]}</span>
                  <br />
                  <span className="mono small muted">{p?.account_id ?? "—"}</span>
                </span>
                <span className="bal">{p ? hbar(p.balance_hbar) : ""}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function Header() {
  const persona = usePersona();
  const path = usePathname();
  const isPublicVerify = path.startsWith("/verify/"); // public page: no persona switcher (App Flow §2)
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link href="/" className="brand"><span className="brand-mark">◆</span> Verified Escrow</Link>
        <nav className="nav" data-testid="nav">
          {NAV[persona].map((n) => (
            <Link key={n.href} href={n.href} className={active(n.href) ? "active" : ""}>
              {n.label}
              {n.held && <HeldCount />}
            </Link>
          ))}
        </nav>
        {!isPublicVerify && <PersonaSwitcher persona={persona} />}
      </div>
    </header>
  );
}

