// Verification page algorithm (TRD §11, App Flow §5.6). Everything that decides MATCH runs in this browser:
// the topic ID and contract address are the bundled ones, the HCS bytes come straight from the public mirror
// node, and both hashes are computed here with @noble/hashes. `api` only supplies the displayed record and
// the sequence pointers, and every pointer it gives is checked.
import { Interface } from "ethers";
import { KEYS, bytesHash, recordHash } from "canonical";
import { fetchWindow, reassemble } from "canonical/hcs";
import { API_URL, type VerifyResponse } from "./api";
import { ABI, CONTRACT_ADDRESS, MIRROR_URL, TOPIC_ID } from "./deployment";

export type StepKey = "db" | "hcs" | "escrow" | "dbHash" | "hcsHash" | "oracle";
export type StepState = "pending" | "running" | "ok" | "fail";
export type Step = { key: StepKey; state: StepState; label: string; detail?: string };

export type ChainEscrow = {
  status: "None" | "Funded" | "Released" | "Held" | "Refunded";
  verdictHash: string; // 0x…
  verdictPassed: boolean;
  sowHash: string; // 0x…
  amountTinybars: bigint;
};

export type Anchor = NonNullable<VerifyResponse["anchor"]> & { consensusTimestamp?: string };

export type Outcome =
  | { kind: "loading" }
  | { kind: "not_found" } // no contract with this escrow ID in the app
  | { kind: "api_error"; message: string }
  | { kind: "not_anchored"; status: string }
  | { kind: "unexpected_topic"; apiTopic: string }
  | { kind: "unexpected_contract"; apiContract: string }
  | { kind: "mirror_unreachable"; message: string }
  | { kind: "incomplete"; have: number; total: number }
  | { kind: "unparseable" } // anchored bytes aren't a v1 record
  | { kind: "wrong_escrow"; anchoredFor: string }
  | { kind: "match"; dbHash: string; hcsHash: string; diff: DiffRow[] }
  | { kind: "mismatch"; dbHash: string; hcsHash: string; diff: DiffRow[] };

/** P1 oracle-consistency check (FR-25, TRD §11 step 7): does the escrow contract commit to the anchored record? */
export type OracleChecks = { hash: boolean; verdict: boolean; sow: boolean; exists: boolean; all: boolean };

export function oracleChecks(chain: ChainEscrow, rec: Record<string, string>, hcsHash: string): OracleChecks {
  const sowHash = "0x" + bytesHash(new TextEncoder().encode(rec.sow ?? ""));
  const c = {
    hash: chain.verdictHash === "0x" + hcsHash,
    verdict: chain.verdictPassed === (rec.verdict === "pass"),
    sow: chain.sowHash === sowHash,
    exists: chain.status !== "None",
  };
  return { ...c, all: c.hash && c.verdict && c.sow && c.exists };
}

export type DiffRow = { field: string; db: string | undefined; hcs: string | undefined; same: boolean };

export type Verification = {
  steps: Step[];
  outcome: Outcome;
  dbContractId?: number;
  appStatus?: string;
  anchor?: Anchor;
  hcsRecord?: Record<string, string>; // authoritative content: shown from Hedera, not from the app
  hcsHash?: string;
  chain?: ChainEscrow | { error: string };
  oracle?: OracleChecks; // P1 (FR-25): set once both the chain read and the anchored record are in
};

const STATUS = ["None", "Funded", "Released", "Held", "Refunded"] as const;
const iface = new Interface(ABI as any[]);

/** escrows(id) through the mirror node's read-only EVM call: no keys, no signing (TRD §11 step 7). */
export async function readEscrow(escrowId: number): Promise<ChainEscrow> {
  const r = await fetch(`${MIRROR_URL}/api/v1/contracts/call`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ data: iface.encodeFunctionData("escrows", [BigInt(escrowId)]), to: CONTRACT_ADDRESS, block: "latest" }),
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`mirror contracts/call HTTP ${r.status}`);
  const out = iface.decodeFunctionResult("escrows", (await r.json()).result);
  return {
    status: STATUS[Number(out.status)] ?? "None",
    verdictHash: String(out.verdictHash).toLowerCase(),
    verdictPassed: Boolean(out.verdictPassed),
    sowHash: String(out.sowHash).toLowerCase(),
    amountTinybars: BigInt(out.amount),
  };
}

const LABELS: Record<StepKey, string> = {
  db: "Loaded displayed record from app database",
  hcs: "Fetched anchored record from testnet mirror node",
  escrow: "Anchored record belongs to this escrow",
  dbHash: "Hashed displayed record in your browser",
  hcsHash: "Hashed HCS record in your browser",
  oracle: "Escrow contract commits to the same record",
};

export function initialSteps(): Step[] {
  return (Object.keys(LABELS) as StepKey[]).map((key) => ({ key, state: "pending", label: LABELS[key] }));
}

export function diffRecords(db: Record<string, string>, hcs: Record<string, string>): DiffRow[] {
  const fields = [...new Set([...KEYS, ...Object.keys(db), ...Object.keys(hcs)])];
  return fields.map((field) => ({ field, db: db[field], hcs: hcs[field], same: db[field] === hcs[field] }));
}

const short = (h: string) => `${h.slice(0, 4)}…${h.slice(-4)}`;

/**
 * Runs the checks in order and reports progress through `onUpdate`, so the checklist renders step by step.
 * Never returns MATCH unless both hashes were computed here and no red condition holds (App Flow §5.6 rule).
 */
export async function verify(escrowId: number, onUpdate: (v: Verification) => void): Promise<Verification> {
  const v: Verification = { steps: initialSteps(), outcome: { kind: "loading" } };
  const emit = () => onUpdate({ ...v, steps: v.steps.map((s) => ({ ...s })) });
  const step = (key: StepKey, state: StepState, detail?: string, label?: string) => {
    const s = v.steps.find((x) => x.key === key)!;
    s.state = state;
    if (detail !== undefined) s.detail = detail;
    if (label) s.label = label;
    emit();
  };
  const finish = (outcome: Outcome) => {
    v.outcome = outcome;
    v.steps.forEach((s) => { if (s.state === "running") s.state = "fail"; });
    emit();
    return v;
  };

  // The on-chain read (FR-25) runs alongside the P0 checks and is folded in by finishAll():
  // it can turn a check red, never a result green.
  const chainP = readEscrow(escrowId).then(
    (chain) => { v.chain = chain; emit(); return chain; },
    (e) => { v.chain = { error: String(e?.message ?? e) }; emit(); return null; },
  );
  const finishAll = async (outcome: Outcome) => {
    const chain = await chainP;
    if (chain && v.hcsRecord && v.hcsHash) {
      v.oracle = oracleChecks(chain, v.hcsRecord, v.hcsHash);
      step("oracle", v.oracle.all ? "ok" : "fail", v.oracle.all ? undefined : "on-chain commitment differs");
    } else {
      step("oracle", "pending", chain ? undefined : "couldn't read the escrow contract");
    }
    return finish(outcome);
  };

  // 1. Displayed record from the app.
  step("db", "running");
  let res: VerifyResponse;
  try {
    const r = await fetch(`${API_URL}/verify/${escrowId}`, { cache: "no-store" });
    if (r.status === 404) return finishAll({ kind: "not_found" });
    if (!r.ok) return finishAll({ kind: "api_error", message: `api HTTP ${r.status}` });
    res = await r.json();
  } catch {
    return finishAll({ kind: "api_error", message: "Backend offline" });
  }
  v.dbContractId = res.db_contract_id;
  v.appStatus = res.status;
  if (!res.record || !res.anchor) {
    step("db", "ok", `status ${res.status}`);
    return finishAll({ kind: "not_anchored", status: res.status });
  }
  step("db", "ok");
  // The backend's pointers must agree with this page's bundled deployment (TRD §6.2).
  if (res.anchor.topic_id !== TOPIC_ID) return finishAll({ kind: "unexpected_topic", apiTopic: res.anchor.topic_id });
  if (res.escrow.contract_address?.toLowerCase() !== CONTRACT_ADDRESS)
    return finishAll({ kind: "unexpected_contract", apiContract: res.escrow.contract_address });
  v.anchor = { ...res.anchor };

  // 2. Anchored bytes straight from the mirror node, bundled topic ID.
  const { sequence_first: first, sequence_last: last } = res.anchor;
  step("hcs", "running", undefined, `Fetching HCS messages #${first}–${last} from testnet mirror node`);
  let got;
  try {
    got = reassemble(await fetchWindow(MIRROR_URL, TOPIC_ID, first, last), res.anchor.tx_id);
  } catch (e: any) {
    step("hcs", "fail", String(e?.message ?? e));
    return finishAll({ kind: "mirror_unreachable", message: String(e?.message ?? e) });
  }
  if (!got.ok) {
    step("hcs", "fail", `${got.have} of ${got.total || res.anchor.chunk_count} chunks`);
    return finishAll({ kind: "incomplete", have: got.have, total: got.total || res.anchor.chunk_count });
  }
  const n = got.chunks.length;
  v.anchor.consensusTimestamp = got.chunks[n - 1].consensus_timestamp;
  step("hcs", "ok", undefined,
    `Fetched HCS messages #${got.chunks[0].sequence_number}–${got.chunks[n - 1].sequence_number} (${n} chunk${n > 1 ? "s" : ""}) from testnet mirror node`);

  // 3. The anchored record must be for the escrow we asked about.
  step("escrow", "running");
  let hcsRecord: Record<string, string>;
  try {
    hcsRecord = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(got.bytes));
    if (typeof hcsRecord !== "object" || hcsRecord === null) throw new Error("not an object");
  } catch {
    step("escrow", "fail", "anchored bytes are not a v1 record");
    return finishAll({ kind: "unparseable" });
  }
  v.hcsRecord = hcsRecord;
  if (hcsRecord.contract_id !== String(escrowId)) {
    step("escrow", "fail", `anchored record is for escrow #${hcsRecord.contract_id}`);
    return finishAll({ kind: "wrong_escrow", anchoredFor: String(hcsRecord.contract_id) });
  }
  step("escrow", "ok", undefined, `Anchored record belongs to escrow #${escrowId}`);

  // 4–5. Both hashes, in this browser.
  step("dbHash", "running");
  let dbHash: string;
  try {
    dbHash = recordHash(res.record);
  } catch (e: any) {
    dbHash = "invalid record: " + String(e?.message ?? e);
  }
  step("dbHash", "ok", short(dbHash));
  step("hcsHash", "running");
  const hcsHash = bytesHash(got.bytes);
  v.hcsHash = hcsHash;
  step("hcsHash", "ok", short(hcsHash));
  step("oracle", "running");

  const diff = diffRecords(res.record, hcsRecord);
  return finishAll(dbHash === hcsHash ? { kind: "match", dbHash, hcsHash, diff } : { kind: "mismatch", dbHash, hcsHash, diff });
}
