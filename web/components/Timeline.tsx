import { hashscanUrl } from "canonical";
import type { TimelineEvent } from "@/lib/api";
import { clock } from "@/lib/format";
import HashPill from "./HashPill";

const LABEL: Record<string, string> = {
  created: "Created", funded: "Funded", submitted: "Deliverable submitted", evaluated: "Evaluated", anchored: "Anchored",
  confirmed: "Confirmed", released: "Released", held: "Held", refunded: "Refunded", error: "Error", retried: "Retried",
  reconciled: "Reconciled", disputed: "Disputed", criteria_reused: "Criteria reused",
};

/** App Flow §5.3 "Timeline": chronological, each with a timestamp and a link. Never shows the verdict. */
export default function Timeline({ events }: { events: TimelineEvent[] }) {
  return (
    <ol className="timeline" data-testid="timeline">
      {events.map((e, i) => (
        <li key={i} className={e.kind}>
          <span className="tl-time mono">{clock(e.created_at)}</span>
          <span className="tl-kind">{LABEL[e.kind] ?? e.kind}</span>
          <span className="tl-msg">{e.message}</span>
          {e.ref?.tx_hash && <HashPill kind="evmtx" id={e.ref.tx_hash} />}
          {e.ref?.tx_id && e.ref?.topic_id && (
            <a className="pill" href={hashscanUrl("transaction", e.ref.tx_id)} target="_blank" rel="noreferrer">seq #{e.ref.sequence} ↗</a>
          )}
          {!e.ref?.tx_id && e.ref?.topic_id && e.ref?.sequence && (
            <a className="pill" href={hashscanUrl("topic", e.ref.topic_id)} target="_blank" rel="noreferrer">topic seq #{e.ref.sequence} ↗</a>
          )}
        </li>
      ))}
    </ol>
  );
}
