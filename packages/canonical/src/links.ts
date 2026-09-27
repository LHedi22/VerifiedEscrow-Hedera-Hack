// HashScan links, built in one place (TRD §11). Formats checked against real testnet objects on Day 1.
export const HASHSCAN_TESTNET = "https://hashscan.io/testnet";

export type LinkKind = "account" | "topic" | "transaction" | "contract";

/** SDK "0.0.5010@1759501320.123456789" -> mirror/HashScan "0.0.5010-1759501320-123456789". */
export function mirrorTxId(sdkTxId: string): string {
  const [account, validStart] = sdkTxId.split("@");
  if (!account || !validStart) return sdkTxId; // already mirror format, or an EVM hash
  const [secs, nanos = "0"] = validStart.split(".");
  return `${account}-${secs}-${nanos.padEnd(9, "0").slice(0, 9)}`;
}

export function hashscanUrl(kind: LinkKind, id: string, base = HASHSCAN_TESTNET): string {
  return `${base}/${kind}/${kind === "transaction" ? mirrorTxId(id) : id}`;
}
