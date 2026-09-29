"use client";

import useSWRImmutable from "swr/immutable";
import { hashscanUrl, type LinkKind } from "canonical";
import { MIRROR_URL } from "@/lib/deployment";
import { shortHash } from "@/lib/format";
import CopyButton from "./CopyButton";

type Kind = LinkKind | "evmtx";

/** Consensus timestamp of an EVM tx hash: HashScan links contract calls by timestamp (TRD §11). */
async function evmTimestamp(hash: string): Promise<string | null> {
  const r = await fetch(`${MIRROR_URL}/api/v1/contracts/results/${hash}`);
  if (!r.ok) return null;
  return (await r.json()).timestamp ?? null;
}

/**
 * Every Hedera artefact renders as a monospace pill with a ↗ HashScan link, built by one helper (App Flow §2).
 * `evmtx` is a relay transaction hash (0x…, 32 bytes); it links once the mirror knows its timestamp.
 */
export default function HashPill({
  kind, id, label, copy = false, full = false,
}: { kind: Kind; id: string | null | undefined; label?: string; copy?: boolean; full?: boolean }) {
  const { data: ts } = useSWRImmutable(kind === "evmtx" && id ? ["evmts", id] : null, () => evmTimestamp(id!));
  if (!id) return <span className="pill pending">{label ?? "—"} pending</span>;
  const text = label ?? (full ? id : kind === "evmtx" || id.length > 20 ? shortHash(id, 8, 6) : id);
  const href = kind === "evmtx" ? (ts ? hashscanUrl("transaction", ts) : null) : hashscanUrl(kind, id);
  return (
    <span className="row" style={{ gap: 4, display: "inline-flex" }}>
      {href ? (
        <a className="pill" href={href} target="_blank" rel="noreferrer" title={`${id} — open on HashScan`}>
          {text} <span className="arrow">↗</span>
        </a>
      ) : (
        <span className="pill" title={id}>{text}</span>
      )}
      {copy && <CopyButton value={id} />}
    </span>
  );
}
