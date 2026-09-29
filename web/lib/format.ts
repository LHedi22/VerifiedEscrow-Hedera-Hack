// Display helpers (App Flow §10: hashes truncated, counters in code points).

export const codePoints = (s: string) => [...s].length; // matches Postgres char_length, not JS .length

export function shortHash(h: string, head = 6, tail = 4): string {
  return h.length <= head + tail + 1 ? h : `${h.slice(0, head)}…${h.slice(-tail)}`;
}

export function hbar(amount: string | null | undefined, digits = 2): string {
  if (amount == null) return "—";
  const n = Number(amount);
  return Number.isFinite(n) ? `${n.toLocaleString("en-US", { maximumFractionDigits: digits })} ℏ` : `${amount} ℏ`;
}

/** Mirror consensus timestamp "1790537028.134162265" -> "14:22:09.481 UTC". */
export function consensusTime(ts: string | null | undefined): string {
  if (!ts) return "—";
  const [secs, nanos = "0"] = ts.split(".");
  const d = new Date(Number(secs) * 1000);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}.${nanos.padEnd(9, "0").slice(0, 3)} UTC`;
}

export function consensusDate(ts: string | null | undefined): string {
  if (!ts) return "—";
  const d = new Date(Number(ts.split(".")[0]) * 1000);
  return `${d.toISOString().slice(0, 10)} ${consensusTime(ts)}`;
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function clock(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
