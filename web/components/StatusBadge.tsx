import type { Status } from "@/lib/api";

// App Flow §5.1 status badge colours, used everywhere.
const BADGE: Record<Status, [string, string]> = {
  DRAFT: ["Draft", "grey"],
  FUNDED: ["Funded · awaiting work", "blue"],
  EVALUATING: ["In progress", "violet"],
  ANCHORING: ["In progress", "violet"],
  CONFIRMING: ["In progress", "violet"],
  SUBMITTING_VERDICT: ["In progress", "violet"],
  RELEASED: ["Paid", "green"],
  HELD: ["Held for review", "amber"],
  REFUNDED: ["Refunded", "slate"],
  ERROR: ["Paused · error", "red"],
};

export default function StatusBadge({ status }: { status: Status }) {
  const [label, colour] = BADGE[status] ?? [status, "grey"];
  return <span className={`badge ${colour}`} data-status={status}>{label}</span>;
}
