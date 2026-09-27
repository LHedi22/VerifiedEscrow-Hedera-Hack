// @noble/hashes v2 (2.4.0 at review time): the ".js" subpaths are required;
// the v1 path "@noble/hashes/sha256" throws ERR_PACKAGE_PATH_NOT_EXPORTED.
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

export const KEYS = ["contract_id","deliverable","model_version","reasoning","schema","sow","timestamp","verdict"] as const;

export function canonicalString(rec: Record<string, string>): string {
  const keys = Object.keys(rec).sort();
  if (keys.join() !== [...KEYS].join()) throw new Error("bad keys");
  for (const k of keys) if (typeof rec[k] !== "string") throw new Error(`non-string value: ${k}`);
  return "{" + keys.map(k => JSON.stringify(k) + ":" + JSON.stringify(rec[k])).join(",") + "}";
}

export function canonicalBytes(rec: Record<string, string>): Uint8Array {
  return new TextEncoder().encode(canonicalString(rec));
}

export function recordHash(rec: Record<string, string>): string {   // synchronous
  return bytesToHex(sha256(canonicalBytes(rec)));
}

export function bytesHash(bytes: Uint8Array): string {             // for reassembled HCS bytes
  return bytesToHex(sha256(bytes));
}

// Mirror of the Python normalize (TRD §5.2), used ONLY by fixture tests.
// Production normalizes once, in Python, at ingestion; nothing downstream re-normalizes.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const TRAILING_WS = /[ \t\n\r\f\v]+$/; // explicit ASCII set: trimEnd() strips a different set

export function normalize(s: string): string {
  if (s.includes("\x00")) throw new Error("NUL character");
  if (LONE_SURROGATE.test(s)) throw new Error("invalid Unicode");
  s = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return s.normalize("NFC").replace(TRAILING_WS, "");
}

export * from "./links";
