# Diagrams

Rendered from the `.mmd` sources with `mmdc` (mermaid-cli 11.15), light theme, white background. Each diagram has an `.svg` (for docs) and a 2× `.png` (for slides).

The docs' own Mermaid blocks are the source of truth for the `readme-`, `trd-`, `appflow-`, `schema-`, `plan-` and `spec-` files. If you edit one in the doc, copy it into its `.mmd` here and re-render.

| File | What | Source |
| --- | --- | --- |
| `readme-architecture` | System architecture | `README.md` § Architecture |
| `trd-architecture` | Architecture incl. laptop boundary and `deployment.json` | `02-TRD.md` §2 |
| `trd-state-machine` | Evaluation state machine | `02-TRD.md` §9 |
| `appflow-screen-map` | Screen map | `03-APP-FLOW.md` §3 |
| `appflow-client-create-fund` | Client: create and fund | `03-APP-FLOW.md` §4.1 |
| `appflow-freelancer-submit` | Freelancer: submit and get paid | `03-APP-FLOW.md` §4.2 |
| `appflow-arbitrator-resolve` | Arbitrator: resolve a held contract | `03-APP-FLOW.md` §4.3 |
| `schema-er` | Entity-relationship diagram | `04-BACKEND-SCHEMA.md` §3 |
| `plan-critical-path` | Critical path | `05-IMPLEMENTATION-PLAN.md` §2 |
| `spec-data-flow` | Data flow step by step (spec v2) | `hedera-verified-escrow-project-spec-v2.md` §8 |
| `pitch-anchor-before-reveal` | Idea slide: judge → anchor → confirm → reveal → pay/hold → anyone verifies | TRD §1, §6 |
| `pitch-architecture` | Architecture slide: off-chain vs Hedera | TRD §2 |
| `pitch-tamper-detection` | Demo / trust slide: DB edit caught by hash + oracle-consistency checks | TRD §11 (verify algorithm), §15 |
| `pitch-trust-model` | Trust model / limitations slide: proven, mitigated, not proven | TRD §15 |
| `pitch-escrow-lifecycle` | On-chain `VerifiedEscrow` status lifecycle | TRD §7.1 |

## Re-render

```bash
cd docs/diagrams
for f in *.mmd; do n=${f%.mmd}
  mmdc -q -i "$f" -o "$n.svg" -t default -b white
  mmdc -q -i "$f" -o "$n.png" -t default -b white -s 2 -w 1600
done
```
