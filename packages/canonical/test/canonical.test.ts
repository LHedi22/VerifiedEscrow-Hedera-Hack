import { describe, expect, it } from "vitest";
import { KEYS, bytesHash, canonicalBytes, canonicalString, normalize, recordHash } from "../src/index";

const rec = (over: Partial<Record<(typeof KEYS)[number], string>> = {}) => ({
  contract_id: "7",
  deliverable: "d",
  model_version: "ollama/qwen2.5:7b-instruct@845dbda0ea48",
  reasoning: "r",
  schema: "vte-record/1",
  sow: "s",
  timestamp: "2026-09-27T10:00:00.000Z",
  verdict: "pass",
  ...over,
});

describe("canonicalString", () => {
  it("sorts keys and uses no spaces", () => {
    const shuffled = Object.fromEntries(Object.entries(rec()).reverse());
    expect(canonicalString(shuffled)).toBe(
      '{"contract_id":"7","deliverable":"d","model_version":"ollama/qwen2.5:7b-instruct@845dbda0ea48",' +
        '"reasoning":"r","schema":"vte-record/1","sow":"s","timestamp":"2026-09-27T10:00:00.000Z","verdict":"pass"}',
    );
  });

  it("emits non-ASCII raw and escapes controls like json.dumps(ensure_ascii=False)", () => {
    const s = canonicalString(rec({ deliverable: "éا\"\\\b\f\n\r\t\x01\x1f\x7f  " }));
    expect(s).toContain(String.raw`"deliverable":"é` + "ا" + String.raw`\"\\\b\f\n\r\t\u0001\u001f` + "\x7f  \"");
  });

  it("rejects missing, extra and non-string keys", () => {
    const { verdict, ...missing } = rec();
    expect(() => canonicalString(missing as Record<string, string>)).toThrow("bad keys");
    expect(() => canonicalString({ ...rec(), extra: "x" })).toThrow("bad keys");
    expect(() => canonicalString({ ...rec(), verdict: 1 as unknown as string })).toThrow("non-string");
  });
});

describe("hashing", () => {
  it("recordHash is SHA-256 of the canonical UTF-8 bytes", () => {
    const r = rec({ sow: "café 🧑‍💻" });
    expect(recordHash(r)).toMatch(/^[0-9a-f]{64}$/);
    expect(recordHash(r)).toBe(bytesHash(canonicalBytes(r)));
  });

  it("matches a known SHA-256 vector", () => {
    expect(bytesHash(new TextEncoder().encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("normalize (Python mirror, tests only)", () => {
  it("converts CRLF/CR, applies NFC, strips trailing ASCII whitespace only", () => {
    expect(normalize("a\r\nb\rc  \t\n")).toBe("a\nb\nc");
    expect(normalize("e\u0301")).toBe("\u00e9");
    expect(normalize("x\u00a0")).toBe("x\u00a0"); // NBSP is not in the strip set
    expect(normalize("x\ufeff")).toBe("x\ufeff"); // trimEnd() would strip this
    expect(normalize("x\x1c")).toBe("x\x1c"); // Python rstrip() would strip this
  });

  it("rejects NUL and lone surrogates", () => {
    expect(() => normalize("a\x00b")).toThrow("NUL");
    expect(() => normalize("a\ud800b")).toThrow("invalid Unicode");
    expect(() => normalize("a\udc00")).toThrow("invalid Unicode");
    expect(normalize("🧑")).toBe("🧑");
  });
});
