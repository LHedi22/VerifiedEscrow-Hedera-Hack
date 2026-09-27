import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalBytes, recordHash } from "../src/index";

// Same files pytest and the /dev/selftest page read (TRD §5.4).
const DIR = join(__dirname, "..", "fixtures");
const CASES = readdirSync(DIR)
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.slice(0, -".json".length))
  .sort();

describe("cross-implementation fixtures", () => {
  it("has all 6 cases", () => expect(CASES).toHaveLength(6));

  it.each(CASES)("%s: bytes and hash match Python", (name) => {
    const rec = JSON.parse(readFileSync(join(DIR, `${name}.json`), "utf8"));
    const expectedBytes = new Uint8Array(readFileSync(join(DIR, `${name}.canonical`)));
    const expectedHash = readFileSync(join(DIR, `${name}.sha256`), "utf8").trim();
    expect(Buffer.from(canonicalBytes(rec)).equals(Buffer.from(expectedBytes))).toBe(true);
    expect(recordHash(rec)).toBe(expectedHash);
  });
});
