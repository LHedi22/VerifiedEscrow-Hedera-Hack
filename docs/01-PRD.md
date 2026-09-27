# PRD — Verified-Then-Paid Escrow

*Product Requirements Document · v1.1 · 26 Sep 2026 · Owner: Hedi (solo build)*
*Source spec: `hedera-verified-escrow-project-spec-v2.md` · Event: Hedera Cross Campus Challenge 2026 — MSB & MedTech Campus Hackathon, 3 Oct 2026*
*Track: AI × Web3 Agents (secondary: DeFi & Tokenization)*

---

## 0. Document set and precedence

| Doc | Owns |
| --- | --- |
| `01-PRD.md` | Scope, priorities, requirement IDs |
| `02-TRD.md` | Architecture, algorithms, contract, trust model |
| `03-APP-FLOW.md` | Screens, UI states, demo run sheet |
| `04-BACKEND-SCHEMA.md` | DDL, API bodies, demo scripts |
| `05-IMPLEMENTATION-PLAN.md` | Schedule, gates, Q&A |
| `06-DEMO-CONTENT.md` | Every SOW and deliverable used in tests, seeds and the demo |
| `00-REVIEW-REPORT.md` | The v1.1 review: what was wrong and what changed |

If two documents disagree while you build, follow the one that owns the topic, then fix the other. The spec v2 is historical: where it differs from these documents, these documents win.

## 1. Summary

Verified-Then-Paid Escrow does four things:

1. It locks a client's HBAR in a Hedera smart contract.
2. A local AI agent judges a freelancer's text deliverable against a Statement of Work (SOW).
3. The full evaluation record is anchored on Hedera Consensus Service (HCS) **before** anyone sees the verdict.
4. Payment is released automatically on a pass. A failing verdict is held for a human arbitrator.

Anyone can later fetch the anchored record from Hedera's public mirror node and check two things:

- that the record the app shows is **exactly the record fixed on Hedera at evaluation time**, before anyone could see or change it
- that the escrow contract's on-chain verdict commits to that same record

The one-line pitch: **the escrow doesn't ask you to trust the AI's verdict — it lets you check it.**

What the check does *not* prove: that the model was run honestly *before* anchoring. That is a stated limitation (§12, TRD §15), not a hidden one.

## 2. Problem

| Failure mode | Today | Consequence |
| --- | --- | --- |
| Centralized arbitration | Platforms decide disputes with no independently checkable record | Both parties must trust the platform |
| Opaque AI judgment | AI graders/reviewers produce verdicts nobody can audit afterwards | An operator can silently alter a verdict and no one downstream can tell |

As AI agents start approving work that moves money (deliverable review, QA sign-off, grading, agent-to-agent tasks), the missing piece is a tamper-evident record of *what the AI decided*, fixed before anyone had the chance to change it.

## 3. Goals and non-goals

### Goals (MVP, 3 Oct)
- **G1** — End-to-end flow on Hedera testnet: create contract → lock HBAR → submit deliverable → AI verdict → HCS anchor → automatic release or hold.
- **G2** — Public verification page that detects tampering of the off-chain record by comparing it against the HCS-anchored record.
- **G3** — A rehearsed, reliable stage demo (4:15 run sheet) including a live `psql` tampering attack caught by the verification page.
- **G4** — Accurate trust claims:
  - The contract trusts an oracle.
  - The oracle's claims (verdict hash and pass/fail) are publicly checkable against HCS via the mirror node.
  - HIP-478 (Accepted) is the right framing: it recommends routing contract↔HCS interaction through an oracle, and it rejected direct topic reads from contracts even though it calls them possible.

### Non-goals (MVP)
- Real user wallets or self-custody (backend-managed demo accounts only).
- File, image, or repository deliverables (text/markdown only).
- Stablecoin or custom HTS token payments (HBAR only).
- Multi-milestone contracts, partial payments, or deadlines/timeouts. So an escrow whose verdict is never submitted stays locked; stated limitation.
- Confidential content. Anchoring the full record makes the SOW and deliverable **public and permanent**; demo content is fictional.
- Production-grade adversarial robustness of the evaluator.
- Mainnet deployment, hosting, or multi-tenant operation.

## 4. Users and personas

All three personas are backend-managed Hedera testnet accounts switchable in the UI (persona switcher). This is a deliberate demo choice, stated openly in the pitch.

| Persona | Wants | Does in the app |
| --- | --- | --- |
| **Client** (e.g. "Amira, startup founder") | Pay only for work that meets the SOW | Creates contract, writes SOW, funds escrow, views verdict, can open a dispute |
| **Freelancer** (e.g. "Youssef, copywriter") | Get paid promptly without chasing approval | Submits deliverable, views verdict, can open a dispute |
| **Arbitrator** (e.g. "Nour, neutral reviewer") | Resolve held contracts on evidence, not trust | Reviews held contracts, runs verification, releases or refunds |
| **Verifier** (anyone, no login) | Independently check a verdict | Opens the public verification page by **escrow ID** (the on-chain ID visible on HashScan) |

The **Oracle** (the backend's operator account) is a system actor, not a persona: it is the only account allowed to call `submitVerdict` and to post to the HCS topic.

## 5. User stories

**Client**
- US-1: As a client, I create a contract with an SOW, an HBAR amount, and a freelancer, so the terms are fixed before work starts.
- US-2: As a client, I fund escrow and see the locked HBAR on HashScan, so I know the money is committed but not yet paid.
- US-3: As a client, I see the AI's verdict, reasoning, and per-criterion results, so I understand why payment did or didn't release.

**Freelancer**
- US-4: As a freelancer, I submit my deliverable as text/markdown against a funded contract.
- US-5: As a freelancer, when my work passes, HBAR arrives in my account without any manual approval.
- US-6: As a freelancer, when my work fails, I can see the reasoning and know an arbitrator will review it.

**Arbitrator**
- US-7: As an arbitrator, I see a queue of contracts held for review, including ones the evaluator couldn't judge.
- US-8: As an arbitrator, I verify the record against HCS before deciding, and I can read the anchored version itself, so I know I'm judging the real verdict.
- US-9: As an arbitrator, I release to the freelancer or refund the client, and the decision is recorded on-chain.

**Verifier (public)**
- US-10: As anyone, I enter an escrow ID and see a green MATCH or red MISMATCH banner, with the HCS sequence numbers and consensus timestamp linking to HashScan.
- US-11: As anyone, when there's a mismatch, I see which fields differ between the displayed record and the HCS-anchored record.
- US-12: As anyone, I see whether the escrow contract's on-chain verdict commits to the same anchored record (P1).

## 6. Functional requirements

Priority: **P0** = required for the 3 Oct demo · **P1** = strongly wanted · **P2** = stretch.

### 6.1 Contract creation and funding
| ID | Requirement | Pri |
| --- | --- | --- |
| FR-1 | Client can create a contract with title (1–120 chars), SOW text (50–4,000 chars after normalization), HBAR amount (> 0, ≤ 100, ≤ 8 decimals), freelancer persona, arbitrator persona (all three parties distinct). | P0 |
| FR-2 | Backend normalizes the SOW (TRD §5.2), then computes `sowHash` = SHA-256 of the normalized SOW's UTF-8 bytes and stores it with the contract. | P0 |
| FR-3 | Funding deposits the HBAR amount into the escrow contract via `createEscrow`, recording `sowHash`, parties, and amount on-chain. A failed funding call leaves the contract in DRAFT. | P0 |
| FR-4 | UI shows the funding transaction (an EVM tx hash) with a HashScan link. | P0 |

### 6.2 Deliverable submission and evaluation
| ID | Requirement | Pri |
| --- | --- | --- |
| FR-5 | Freelancer can submit a text/markdown deliverable (1–8,000 chars after normalization) for a funded contract; one submission per contract in the MVP, enforced atomically. | P0 |
| FR-6 | Agent derives 3–7 presence-checkable acceptance criteria from the SOW, cached in `evaluations.criteria`. | P0 |
| FR-7 | Agent evaluates the deliverable against the criteria and returns schema-valid JSON: per-criterion results, `reasoning`, `confidence` (0–1), `injection_suspected`. **Code** computes `verdict` (pass/fail) from them (TRD §8.3). | P0 |
| FR-8 | Deliverable is wrapped in delimited tags with an explicit "data, not instructions" rule (spec §12). A code-side regex backstop also flags text addressed to the evaluator. | P0 |
| FR-9 | Invalid model output is retried up to 2 times (3 attempts). After that, the system anchors a record with verdict `fail` and reasoning prefixed `EVALUATION_ERROR:` and submits it like any fail. The escrow is then `Held` on-chain and the arbitrator can resolve it (`hold_reason = EVALUATION_ERROR`). An unreachable evaluator is not an evaluation error: the contract pauses in `ERROR` and can be retried. | P0 |
| FR-10 | A pass with confidence below a configurable threshold (default 0.7), or with `injection_suspected`, is treated as fail-for-review. | P0 |

### 6.3 Anchoring and verdict submission
| ID | Requirement | Pri |
| --- | --- | --- |
| FR-11 | Backend builds the canonical record (TRD §5) and computes `recordHash` before the verdict is visible to anyone. **Visibility rule:** verdict, reasoning, criteria results and the `/verify` record are served only after the mirror node has confirmed the anchored bytes. | P0 |
| FR-12 | Full canonical record (not just the hash) is submitted to the deployment's HCS topic, chunked as needed. | P0 |
| FR-13 | Backend confirms the message via the mirror node (all chunks, hash match) and stores topic ID, first and last sequence numbers, and consensus timestamp. | P0 |
| FR-14 | Only after mirror-node confirmation does the backend call `submitVerdict(escrowId, passed, recordHash, sowHash)`. | P0 |
| FR-15 | Pass → contract releases HBAR to the freelancer. Fail → contract marks `Held` and emits `HeldForReview`. The contract stores `verdictHash` and `verdictPassed`. | P0 |
| FR-16 | UI shows a staged status: *Evaluating → Anchoring to HCS → Confirming consensus → Submitting verdict → Released/Held*. | P0 |

### 6.4 Disputes and arbitration
| ID | Requirement | Pri |
| --- | --- | --- |
| FR-17 | Arbitrator sees all `HELD` contracts in a queue, with the hold reason. | P0 |
| FR-18 | Arbitrator can call `resolveDispute(escrowId, release)` → release to freelancer or refund to client. | P0 |
| FR-19 | Client or freelancer can flag a *released* contract as disputed; this is off-chain only (funds already moved) and exists to drive verification. | P1 |

### 6.5 Public verification
| ID | Requirement | Pri |
| --- | --- | --- |
| FR-20 | Public page (no persona needed) accepts an **escrow ID**. | P0 |
| FR-21 | Page reads the displayed record from the backend and the anchored record from the **mirror node directly** (browser → mirror node, not via backend). The **topic ID and contract address come from the build** (`shared/deployment.json`), not from the backend. | P0 |
| FR-22 | Page recomputes the hash of the displayed record with the shared canonicalization (TRD §5), checks the anchored record belongs to the requested escrow, and shows MATCH (green) or MISMATCH (red). It also shows the anchored record's own verdict and reasoning. | P0 |
| FR-23 | On mismatch, page shows a field-level diff between the database record and the HCS record. | P1 |
| FR-24 | Page shows topic ID, sequence numbers, consensus timestamp, and escrow ID, each linked to HashScan. | P1 |
| FR-25 | **Oracle-consistency check.** The page reads `escrows(escrowId)` from the contract via the mirror node and checks: on-chain `verdictHash` = anchored record hash; `verdictPassed` = (anchored verdict is `pass`); `sowHash` = hash of the anchored SOW. This is what makes G4 literally true, and it defeats an operator who anchors a second, doctored record. | **P1** (was P2) |
| FR-30 | **Topic scan.** Page finds the anchored record by scanning the topic, with no backend pointers, so verification works even if the DB rows are deleted. It flags 2+ different records for one escrow. | P1 |

### 6.6 Demo support
| ID | Requirement | Pri |
| --- | --- | --- |
| FR-26 | Persona switcher in the header (Client / Freelancer / Arbitrator). | P0 |
| FR-27 | Seed script creates **three** demo contracts (S1 pass, S2 fail, S3 injection) from `06-DEMO-CONTENT.md`, asserts their end states, and snapshots the DB. | P0 |
| FR-28 | `demo/tamper.sql`, `demo/reset` (restores seed state in seconds, bash and PowerShell) and `demo/recycle` (returns the freelancer's HBAR to the client). | P0 |
| FR-29 | "Demo mode" fallback: a pre-recorded verdict can be replayed if Ollama fails on stage. It is still anchored live to HCS, and its `model_version` is `replay/<original>`, so **the anchored record itself says it was replayed**. The UI shows a chip. | P1 |
| FR-31 | Under `DEMO_MODE=1`, the freelancer editor has an "Insert sample" menu (good / weak) from `06-DEMO-CONTENT.md`. | P1 |

## 7. Non-functional requirements

| ID | Category | Requirement |
| --- | --- | --- |
| NFR-1 | Determinism | Canonical serialization is byte-identical across Python, the TS package (Node) and the browser; enforced by shared fixtures with expected bytes and hashes, plus an independent `sha256sum` check. |
| NFR-2 | Latency | End-to-end submit → released/held in ≤ 60 s on the demo laptop. Gate: one full S1 evaluation (both steps) in ≤ 40 s on Day 0, or apply the TRD §8.1 fallbacks. |
| NFR-3 | Reproducibility | Model called with temperature 0, fixed seed and committed prompts; `model_version` records the exact Ollama tag and digest. LLM output isn't guaranteed identical across hardware, so re-running is a strong check, not a proof. |
| NFR-4 | Offline tolerance | Everything except Hedera testnet runs locally (Docker Postgres, native Ollama); no other cloud dependency. |
| NFR-5 | Security (demo-grade) | Private keys only in `hedera-svc/.env`, never committed, never sent to the frontend. Oracle key distinct from persona keys. |
| NFR-6 | Record size | Canonical record ≤ 18,000 bytes (SDK defaults allow 20 × 1,024); reasoning capped at 3,000 chars in code. |
| NFR-7 | Observability | Every Hedera transaction is stored and shown with a HashScan link. |
| NFR-8 | Honesty | Every trust claim in the UI and pitch matches what the system actually enforces, including the MATCH banner wording and the HIP-478 line. |

## 8. Scope summary

| In MVP (P0) | Strongly wanted (P1) | Stretch (P2) | Out |
| --- | --- | --- | --- |
| 3 personas, backend-managed keys | Oracle-consistency check (FR-25) | HTS receipt NFT (if the prep session asks for HTS) | Wallet connect |
| Text/markdown deliverables | Topic scan (FR-30) | Hashing criteria/results into the record | File/repo deliverables |
| Local Ollama evaluator + confidence/injection routing | Field-level diff on mismatch | `prompt_version` in the record | HFS/IPFS pinning |
| Full-record HCS anchoring | Disputing a released contract | Hedera Agent Kit tools | Stablecoins / custom HTS tokens |
| Hardhat escrow contract (8 tests) | Demo-mode replay fallback | | Multi-milestone, deadlines |
| Public verification page | Insert-sample menu | | Mainnet, hosting |

## 9. Success metrics

For a hackathon, success is measured by the demo and the judging rubric:

| Metric | Target |
| --- | --- |
| Happy-path demo runs clean end to end | 5 consecutive rehearsals without failure by 2 Oct |
| Tamper detection | `psql UPDATE` on any hashed field except `contract_id` → red MISMATCH, 100% of rehearsals. Changing `contract_id` makes the app lose the record; the P1 topic scan still finds it |
| Control case | Untouched record → green MATCH, 100% of rehearsals |
| Hash self-test (Python / Node / browser / `sha256sum`) | Passes on Day 1 before anything else is built |
| Oracle-consistency check | Green on every seeded contract (P1) |
| Hedera services exercised with real transactions | HCS, smart contracts (HSCS), HBAR transfers — all visible on HashScan |
| Pitch Q&A | Prepared answers for: HIP-478, prompt injection, local model trust, content deletion, public content, re-anchoring |

## 10. Assumptions and constraints

- Solo developer; build days 27–29 Sep, polish and rehearsal 30 Sep–2 Oct, presentation 3 Oct.
- Hedera **testnet**. The faucet currently advertises 10 ℏ per day; Portal refills were 1,000 ℏ per 24 h as of 2024. **Verify on Day 0.** The demo uses 5 ℏ escrows plus a recycle script to stay inside either budget.
- Testnet can be reset with 2–4 weeks' notice (`status.hedera.com`); check on Day 0.
- Local Ollama (native install) with a 7–8B instruct model (`qwen2.5:7b-instruct`) in JSON mode on a ~16 GB laptop; 3B fallback if the speed gate fails.
- Local Postgres in Docker; demo runs from the laptop. All services and scripts run natively on Windows, with Docker Desktop for Postgres only (TRD §18).
- Hedera calls go through a small Node.js sidecar using the Hedera JS SDK (and Agent Kit where useful); FastAPI orchestrates.

## 11. Changes from spec v2 driven by locked decisions

| Spec v2 said | This PRD decides | Why |
| --- | --- | --- |
| `model_version: "claude-sonnet-4-6"` | `model_version: "ollama/<tag>@<12-hex digest>"` | Local model chosen |
| "HTS payment" | **HBAR native transfer** from the contract | HBAR is Hedera's native cryptocurrency, not an HTS token. Pitch says "HCS + Smart Contracts + HBAR transfers", or add an HTS receipt NFT (P2) if a genuine HTS touchpoint is wanted |
| Contract assumes funds exist | Explicit `createEscrow` payable function | The spec's pseudocode never showed deposits |
| Deliverable "raw text or content hash if large" | Raw text only, ≤ 8,000 chars | Text-only scope; keeps full-record anchoring simple |
| HIP-478 "rejected because EVM execution must stay deterministic" | HIP-478 rejected direct reads for *consistency* and recommends the oracle route | That is what HIP-478 actually says (checked 26 Sep) |
| Canonical JSON with "`\n` line endings" | No whitespace at all; newlines inside values are escaped | The spec's wording contradicted "no extraneous whitespace" |

## 12. Risks (product level)

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Local model gives inconsistent or low-quality verdicts | Med | High | Temp 0, fixed seed, JSON mode, criteria-first two-step prompt, presence-based SOWs, eval suite run 3× |
| Local model too slow on the demo laptop | Med | High | Day 0 speed gate; `keep_alive`; criteria at funding; 3B fallback |
| Judges question trusting a local model run by the operator | High | Med | That's the point of the anchor: the operator can't change the verdict *after* it's recorded. Pre-anchoring manipulation is a stated limitation |
| Operator anchors a second, doctored record | Low | High | Oracle-consistency check (FR-25) + topic scan (FR-30) |
| HIP-478 claim challenged | Med | Med | Corrected wording (G4, §11); the design *is* the oracle pattern HIP-478 recommends |
| "HTS" claim challenged | Med | Med | Corrected framing in §11 |
| Testnet HBAR runs out | Med | High | 5 ℏ escrows, recycle script, Day 0 balance check |
| Testnet reset during the week | Low | High | Status page check; scripted redeploy + reseed |
| Ollama slow or crashes on stage | Low–Med | High | Warm + `keep_alive`; demo-mode replay (FR-29) |
| Testnet or mirror-node latency spike | Low | High | Visible pending state; pre-funded seeds; backup screen recording |
| Solo time overrun | Med | High | HCS + HBAR flow first; contract dispute UI trimmed before the verification page is touched |

## 13. Open questions

1. Does the prep session on 30 Sep expect HTS specifically? If yes, add the P2 HTS "Verified Delivery" receipt NFT minted to the freelancer on release.
2. Is the 3 Oct presentation the real deadline, or is there a window until the 4Hacks submission deadline (10 Oct 19:00)?
3. Do the bootcamp materials include Hedera Agent Kit examples worth reusing in the sidecar?
4. **How long is the presentation slot, and what does it include** (slides + live demo + Q&A)? The run sheet alone is 4:15.
5. **Is there reliable internet at the venue, and can you plug your laptop into the projector?** The live demo needs testnet access.

## 14. Glossary

- **SOW** — Statement of Work; the client's written requirements.
- **Canonical record** — the fixed-schema, all-string JSON of contract (escrow) ID, SOW, deliverable, verdict, reasoning, model version, schema tag and timestamp (TRD §5).
- **recordHash / verdictHash** — SHA-256 of the canonical record; the same value is sent to HCS (as the record itself) and to the contract.
- **Escrow ID** — the on-chain ID assigned by `createEscrow`; used in the record, on HashScan and in `/verify/:escrowId`.
- **Anchored / confirmed** — anchored: HCS receipts returned (consensus reached). Confirmed: the mirror node serves the same bytes, so anyone can verify. The verdict is revealed at confirmation.
- **Oracle** — the backend's Hedera account, the only caller allowed to submit verdicts and post to the topic.
- **Mirror node** — Hedera's public read API; the independent path used for verification.
- **HIP-478** — Accepted Hedera proposal on contract↔HCS interoperability through an oracle network. It lists direct topic reads from contracts under Rejected Ideas: possible, but rejected for consistency.

## Change log

| Version | Change |
| --- | --- |
| v1.1 (26 Sep) | §0 precedence. Summary and banner claims narrowed to what is proven. HIP-478 wording corrected everywhere. FR-1/2/5 limits and normalization explicit. FR-9: evaluation errors anchored and held on-chain (v1.0 left funds stuck). FR-10 → P0. FR-11 single visibility rule. FR-20–22 escrow ID and build-time topic/contract. FR-25 → P1 with 4 checks. New FR-30 (topic scan), FR-31 (insert sample). FR-27 three seeds. FR-29 replay labelled inside the record. Public-content non-goal. New risks, open questions 4–5, glossary entries. |
