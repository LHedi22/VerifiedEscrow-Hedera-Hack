"use client";

import Link from "next/link";
import useSWR from "swr";
import type { Contract } from "@/lib/api";
import { CONTRACT_ADDRESS } from "@/lib/deployment";
import { shortHash } from "@/lib/format";
import { readEscrow } from "@/lib/verify";
import CopyButton from "./CopyButton";
import HashPill from "./HashPill";

const TX_LABEL: Record<string, string> = { CREATE_ESCROW: "Funding tx", SUBMIT_VERDICT: "Verdict tx", RESOLVE_DISPUTE: "Resolution tx" };

/** App Flow §5.3 right column. verdictHash is read from the chain (mirror contracts/call), not from `api`. */
export default function OnChainPanel({ c }: { c: Contract }) {
  const hasVerdict = c.txs.some((t) => t.kind === "SUBMIT_VERDICT");
  const { data: chain } = useSWR(c.escrow_id !== null ? ["escrow", c.escrow_id, c.status] : null, () => readEscrow(c.escrow_id!), {
    revalidateOnFocus: false,
  });
  const a = c.anchor;
  const vh = chain && /^0x0+$/.test(chain.verdictHash) ? null : chain?.verdictHash;
  return (
    <aside className="card onchain" data-testid="onchain">
      <p className="section-title">On-chain</p>
      <dl>
        <dt>Escrow</dt>
        <dd>{c.escrow_id !== null ? <HashPill kind="contract" id={CONTRACT_ADDRESS} label={`#${c.escrow_id}`} /> : <span className="pill pending">not funded</span>}</dd>
        {chain && <><dt>On-chain status</dt><dd data-testid="onchain-status"><strong>{chain.status}</strong></dd></>}
        {["CREATE_ESCROW", "SUBMIT_VERDICT", "RESOLVE_DISPUTE"].map((kind) => {
          const tx = c.txs.find((t) => t.kind === kind);
          if (!tx && kind === "RESOLVE_DISPUTE") return null;
          return (
            <div key={kind}>
              <dt>{TX_LABEL[kind]}</dt>
              <dd data-testid={`tx-${kind}`}>{tx ? <HashPill kind="evmtx" id={tx.tx_hash} /> : <span className="muted">—</span>}</dd>
            </div>
          );
        })}
        <dt>sowHash</dt>
        <dd className="row" style={{ gap: 4 }}><code className="hash">0x{shortHash(c.sow_hash, 6, 4)}</code><CopyButton value={"0x" + c.sow_hash} /></dd>
        <dt>HCS msgs</dt>
        <dd>
          {a ? (
            <HashPill kind="transaction" id={a.tx_id} label={`#${a.sequence_first}–${a.sequence_last}${a.confirmed ? "" : " (confirming)"}`} />
          ) : <span className="muted">#— (pending)</span>}
        </dd>
        <dt>verdictHash</dt>
        <dd className="row" style={{ gap: 4 }}>
          {hasVerdict && vh ? <><code className="hash">{shortHash(vh, 8, 6)}</code><CopyButton value={vh} /></> : <span className="muted">—</span>}
        </dd>
      </dl>
      {a?.confirmed && c.escrow_id !== null ? (
        <Link className="btn primary block" href={`/verify/${c.escrow_id}`} data-testid="verify-link" style={{ marginTop: 16 }}>Verify this record</Link>
      ) : (
        <button className="btn block" disabled style={{ marginTop: 16 }} title="Available once the record is confirmed on the mirror node">Verify this record</button>
      )}
    </aside>
  );
}
