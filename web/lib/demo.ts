// Demo texts from docs/06-DEMO-CONTENT.md, via demo/seed_content.json (bundled at build time).
import content from "../../demo/seed_content.json";

export type Seed = { id: string; title: string; sow: string; deliverable: string; amount_hbar: string };
const seeds = (content as { seeds: Seed[] }).seeds;
const byId = (id: string) => seeds.find((s) => s.id === id)!;

export const S1 = byId("S1"); // "Use example SOW" template + the live on-stage run
export const S2 = byId("S2");
/** Insert-sample menu (FR-31, P1): good = S1 deliverable, weak = S2 deliverable. */
export const SAMPLES = { good: S1.deliverable, weak: S2.deliverable };
