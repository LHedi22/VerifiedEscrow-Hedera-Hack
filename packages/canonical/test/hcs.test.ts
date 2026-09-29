// Same cases as api/tests/test_mirror.py, so the TS and Python reassembly rules can't drift.
import { describe, expect, it } from "vitest";
import { bytesHash } from "../src/index";
import { type MirrorMessage, parseTxId, reassemble } from "../src/hcs";

const TX = "0.0.1001@1759501329.481234567";
const OURS = { account_id: "0.0.1001", nonce: 0, scheduled: false, transaction_valid_start: "1759501329.481234567" };
const FOREIGN = { account_id: "0.0.2002", nonce: 0, scheduled: false, transaction_valid_start: "1759501329.999999999" };
const RECORD = new TextEncoder().encode('{"contract_id":"dev-1","deliverable":"café ا ' + "x".repeat(2500) + '"}');

const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));

function msgs(data: Uint8Array, initial: typeof OURS, seq0: number, size = 1024): MirrorMessage[] {
  const parts: Uint8Array[] = [];
  for (let i = 0; i < data.length; i += size) parts.push(data.slice(i, i + size));
  return parts.map((p, n) => ({
    sequence_number: seq0 + n,
    consensus_timestamp: `17595013${30 + n}.000000001`,
    message: b64(p),
    chunk_info: { initial_transaction_id: initial, number: n + 1, total: parts.length },
  }));
}

describe("hcs reassembly (TRD §6.1)", () => {
  it("parses SDK tx ids and pads nanos", () => {
    expect(parseTxId("0.0.5@1759501329.48123")).toEqual(["0.0.5", "1759501329.481230000"]);
    expect(parseTxId(TX)).toEqual(["0.0.1001", "1759501329.481234567"]);
    expect(() => parseTxId("garbage")).toThrow();
  });

  it("reassembles three chunks; hash matches", () => {
    const m = msgs(RECORD, OURS, 10);
    expect(m).toHaveLength(3);
    const r = reassemble(m, TX);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(bytesHash(r.bytes)).toBe(bytesHash(RECORD));
      expect(r.chunks.map((c) => c.sequence_number)).toEqual([10, 11, 12]);
    }
  });

  it("ignores a foreign chunk mixed in", () => {
    const ours = msgs(RECORD, OURS, 10);
    const foreign = msgs(new Uint8Array(1500).fill(88), FOREIGN, 11)[0];
    const r = reassemble([ours[0], foreign, ...ours.slice(1)], TX);
    expect(r.ok && bytesHash(r.bytes) === bytesHash(RECORD)).toBe(true);
  });

  it("sorts out-of-order chunks", () => {
    const r = reassemble(msgs(RECORD, OURS, 10).reverse(), TX);
    expect(r.ok && bytesHash(r.bytes) === bytesHash(RECORD)).toBe(true);
  });

  it("reports a missing chunk as incomplete (2 of 3)", () => {
    const m = msgs(RECORD, OURS, 10);
    expect(reassemble([m[0], m[2]], TX)).toEqual({ ok: false, have: 2, total: 3 });
  });

  it("treats null chunk_info as 1-of-1", () => {
    const abc = new TextEncoder().encode("abc");
    const r = reassemble([{ sequence_number: 5, consensus_timestamp: "1.2", message: b64(abc), chunk_info: null }], TX);
    expect(r.ok && bytesHash(r.bytes) === bytesHash(abc)).toBe(true);
  });
});
