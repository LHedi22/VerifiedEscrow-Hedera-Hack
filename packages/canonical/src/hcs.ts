// HCS record reassembly in the browser (TRD §6.1 rule 5, §6.2). Same rules as api/app/services/mirror.py:
// - keep only messages whose chunk_info.initial_transaction_id matches the expected transaction
//   (account_id + transaction_valid_start);
// - chunk_info == null is a complete 1-of-1 message (only when the query window is exactly that message);
// - sort by chunk_info.number, require 1..total with no gaps, base64-decode each message, concatenate.

export type ChunkInfo = {
  initial_transaction_id: { account_id: string; transaction_valid_start: string; nonce?: number; scheduled?: boolean };
  number: number;
  total: number;
};

export type MirrorMessage = {
  sequence_number: number;
  consensus_timestamp: string;
  message: string; // base64
  chunk_info: ChunkInfo | null;
  topic_id?: string;
};

export type Reassembled =
  | { ok: true; bytes: Uint8Array; chunks: MirrorMessage[] }
  | { ok: false; have: number; total: number }; // incomplete: "2 of 3 chunks"

/** SDK "0.0.5@1759501329.48123" -> ["0.0.5", "1759501329.481230000"] (mirror format, 9-digit nanos). */
export function parseTxId(txId: string): [string, string] {
  const at = txId.indexOf("@");
  const account = at < 0 ? "" : txId.slice(0, at);
  const [secs = "", nanos = ""] = (at < 0 ? "" : txId.slice(at + 1)).split(".");
  if (!account || !/^\d+$/.test(secs)) throw new Error(`bad transaction id: ${txId}`);
  return [account, `${secs}.${nanos.padEnd(9, "0").slice(0, 9)}`];
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function reassemble(messages: MirrorMessage[], txId: string): Reassembled {
  const [account, validStart] = parseTxId(txId);
  const chunks: MirrorMessage[] = [];
  for (const m of messages) {
    const info = m.chunk_info;
    if (info == null) {
      if (messages.length === 1) return { ok: true, bytes: base64ToBytes(m.message), chunks: [m] };
      continue;
    }
    const init = info.initial_transaction_id ?? ({} as ChunkInfo["initial_transaction_id"]);
    if (init.account_id === account && init.transaction_valid_start === validStart) chunks.push(m);
  }
  if (!chunks.length) return { ok: false, have: 0, total: 0 };
  chunks.sort((a, b) => a.chunk_info!.number - b.chunk_info!.number);
  const total = chunks[0].chunk_info!.total;
  const complete =
    chunks.length === total &&
    chunks.every((m, i) => m.chunk_info!.number === i + 1 && m.chunk_info!.total === total);
  if (!complete) return { ok: false, have: new Set(chunks.map((m) => m.chunk_info!.number)).size, total };
  return { ok: true, bytes: concat(chunks.map((m) => base64ToBytes(m.message))), chunks };
}

/** Bounded window, the same query the api polls (TRD §6.1 step 4). Throws on network/HTTP failure. */
export async function fetchWindow(
  mirrorUrl: string, topicId: string, first: number, last: number, fetchImpl: typeof fetch = fetch,
): Promise<MirrorMessage[]> {
  const url = `${mirrorUrl}/api/v1/topics/${topicId}/messages?sequencenumber=gte:${first}&sequencenumber=lte:${last}&limit=25`;
  const r = await fetchImpl(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`mirror node HTTP ${r.status}`);
  return ((await r.json()).messages ?? []) as MirrorMessage[];
}
