# Verified-Then-Paid Escrow — Hedera Cross Campus Challenge Project

*MSB & MedTech Campus Edition — Hedera Cross Campus Challenge 2026*
*As of: 22 September 2026*

## 1. Project overview

An AI agent evaluates a freelance deliverable against its Statement of Work (SOW), logs its verdict and a cryptographic hash of that evaluation immutably to Hedera Consensus Service (HCS), and a smart contract releases HTS payment automatically on a passing verdict. Anyone — client, freelancer, or a third-party arbitrator — can independently verify, after the fact, that the shown verdict matches what the AI actually evaluated, closing the central trust gap in AI-mediated payments.

The project combines two ideas into one pipeline:
- **AI-verified milestone escrow** — an agent decides whether a deliverable meets its spec, and that decision gates payment.
- **Trusted-data anchoring** — every AI judgment is hashed and anchored on Hedera before it is shown to anyone, so the judgment itself becomes tamper-evident.

Track: **AI × Web3 Agents**, with meaningful overlap into **DeFi & Tokenization** (the payment/escrow mechanism).

## 2. Problem and motivation

Freelance and contract work, and increasingly AI-agent-mediated commerce, have no trust-minimized way to confirm a deliverable meets its spec before payment moves. Two failure modes recur:

- **Centralized trust**: platforms or individuals arbitrate disputes with no independently checkable record of what was evaluated or why. The client has to trust the platform; the freelancer has to trust the platform's dispute process.
- **Opaque AI judgment**: as AI agents start grading, evaluating, or approving work (exam grading, deliverable review, automated QA, content moderation), there is no way to prove after the fact that the AI's shown verdict is the verdict it actually produced. An operator could alter a verdict silently, and no one downstream would know.

This project addresses both by making the AI's evaluation the trigger for payment release, and by anchoring that evaluation immutably on Hedera *before* it is shown to either party. The escrow doesn't just ask people to trust the AI — it gives them a way to check it.

## 3. Concept summary — how it works end to end

1. A client creates a contract: SOW text, payment amount, freelancer's Hedera account.
2. Funds (HBAR or an HTS token) are locked into an escrow account/contract.
3. The freelancer submits a deliverable.
4. An AI agent parses the SOW into structured acceptance criteria, evaluates the deliverable against them, and produces a pass/fail verdict with reasoning.
5. Before the verdict is shown to anyone, the agent computes `hash(SOW + deliverable + verdict + reasoning + model_version + timestamp)` and submits it as a message to a dedicated HCS topic.
6. The smart contract checks the HCS-confirmed verdict:
   - **Pass** → HTS payment releases automatically to the freelancer.
   - **Fail** → funds are held, flagged for human review.
7. Either party can independently pull the HCS record via a Hedera mirror node, recompute the hash from the original SOW and deliverable, and confirm the verdict shown matches the verdict that was actually computed — this is the dispute-resolution mechanism.

## 4. Thematic and judging alignment

**Primary theme:** AI × Web3 Agents — "AI agents, automated transactions, intelligent coordination, trusted data and auditable AI-powered services." This project is close to a literal implementation of that description.

**Secondary theme:** DeFi & Tokenization — the escrow and payment-release mechanism is itself a new model for managing and transferring value conditionally.

| Judging criterion | Weight | How this project scores against it |
|---|---|---|
| Meaningful Hedera integration | 25% | HCS is structurally load-bearing — the dispute mechanism does not work without it. HTS/HSCS handle real value transfer. Three services doing functional work, not decoration. |
| Technical execution and functionality | 20% | Reuses a known architecture (FastAPI agent evaluation pipeline) rather than building from zero; scoped to a working MVP within the remaining timeline. |
| Problem relevance and clarity | 15% | Payment disputes in freelance/AI-mediated work are a concrete, well-understood problem. |
| Innovation and differentiation | 15% | The "catch the tampering" dispute demo is a distinguishing feature most competing escrow projects won't have. |
| Real-world impact and adoption potential | 15% | Directly usable pattern for freelance platforms, AI-graded credentialing, and any AI-gated payment flow. |
| Pitch and product demonstration | 10% | Built around one clear, stageable moment: live evaluation → HCS confirmation → tamper detection. |

## 5. System architecture

**Components:**
- **Backend (FastAPI):** SOW/deliverable ingestion, LLM-based agent evaluation, hash computation, Hedera SDK calls (HCS submission, HTS transfer or HSCS invocation).
- **AI agent:** parses SOW into structured acceptance criteria; evaluates submitted deliverable; returns structured verdict (pass/fail, confidence, reasoning).
- **Hedera Consensus Service (HCS) topic:** append-only log of verdict hashes — the audit trail.
- **Hedera Smart Contract Service (HSCS) contract (or backend-triggered HTS transfer as a lighter-weight alternative):** holds escrowed funds, releases on a confirmed passing verdict.
- **Hedera Token Service (HTS):** the payment asset — HBAR or a stablecoin token.
- **Frontend (Next.js):** contract creation flow, live status display, and a public verification page that reads directly from the HCS topic via the mirror node REST API.
- **Mirror node:** the public, independent read path anyone uses to verify the audit trail without trusting the project's own backend.

## 6. Hedera integration details

- **HCS (Hedera Consensus Service):** the core trust mechanism. Every AI evaluation — its hash, not necessarily its full content — is submitted as a topic message immediately after generation, before the verdict is shown to either party. This gives an ordered, timestamped, tamper-evident record that is independently readable by anyone via the mirror node.
- **HTS (Hedera Token Service):** represents the escrowed value. HBAR is simplest for an MVP; a stablecoin token is a stronger fit if stablecoin patterns were covered in the bootcamp material, since freelance payments are typically priced in stable value.
- **HSCS (Hedera Smart Contract Service):** optional but strengthens the "trustless" claim — a Solidity/EVM contract that releases funds only when it receives a verdict hash matching what's on the HCS topic, rather than trusting a backend service to trigger the transfer directly. If time is short, a backend-triggered HTS transfer gated on the HCS-confirmed verdict is a legitimate lighter-weight substitute — still genuine Hedera integration, just without the on-chain enforcement layer.
- **Hedera Agent Kit (if covered in training):** worth checking whether the bootcamp materials include Hedera's own agent tooling — using it directly, rather than the raw SDK, would strengthen the "meaningful integration" score and save build time.

## 7. Data flow — step by step

1. Client submits SOW + payment amount + freelancer's Hedera account → backend creates a contract record and locks funds in escrow.
2. Freelancer submits deliverable → backend stores it and triggers agent evaluation.
3. Agent generates structured acceptance criteria from the SOW (first pass, cached).
4. Agent evaluates the deliverable against those criteria → produces verdict + reasoning + confidence score.
5. Backend computes `hash(SOW + deliverable + verdict + reasoning + model_version + timestamp)`.
6. Backend submits that hash as an HCS topic message via the Hedera SDK.
7. Backend (or smart contract, if using HSCS) checks the confirmed HCS message and triggers release or hold accordingly.
8. Frontend polls or subscribes to contract status and displays it to both parties.
9. Verification page: anyone enters a contract ID, backend/mirror node returns the original SOW + deliverable + the HCS-recorded hash; the page recomputes the hash client-side and shows match/mismatch.

## 8. Smart contract design

Core logic (Solidity-style pseudocode):

```
struct Contract {
  address client;
  address freelancer;
  bytes32 sowHash;
  uint256 amount;
  bool released;
}

function submitVerdict(uint256 contractId, bool passed, bytes32 verdictHash) external onlyOracle {
  // verdictHash must match a hash the oracle also posted to the HCS topic
  if (passed) {
    release(contractId);
  } else {
    emit HeldForReview(contractId, verdictHash);
  }
}
```

Design principle: the contract does not trust the oracle's `passed` boolean alone. It trusts that `verdictHash` is independently verifiable against the HCS topic — anyone, including a human arbitrator during a dispute, can pull the HCS message and recompute the hash from the actual SOW and deliverable to confirm the contract released funds on a verdict that genuinely matches what was submitted.

If HSCS is skipped for time reasons, the same gating logic runs in the backend instead: the backend only calls the HTS transfer function after it has itself confirmed (by reading back from the mirror node) that the verdict hash it submitted was accepted onto the HCS topic.

## 9. Dispute and verification flow

1. Freelancer or client disputes a verdict (most commonly a "failed" one).
2. Either party pulls the HCS record for that contract via the mirror node — a public, independent read path.
3. A human arbitrator (or, for the demo, the presenter playing that role) recomputes the hash from the original SOW and deliverable and compares it to what's recorded on HCS.
4. **Mismatch** → proof of tampering; strong, objective signal for the arbitrator.
5. **Match** → the AI's original reasoning (also logged) is reviewed on its merits, since the record confirms the verdict shown is the verdict that was actually produced.

This flow is the differentiator: it is the reason the project needs HCS at all, rather than HCS being decorative "extra blockchain."

## 10. Build plan and timeline

Remaining program schedule: Hackathon Preparation Session on 30 September 2026, Campus Hackathon on 3 October 2026.

- **Day 1:** FastAPI backend — SOW/deliverable ingestion, LLM evaluation call producing structured verdict + reasoning, hash computation, HCS submission via Hedera SDK. Goal: one message landing on a Hedera testnet topic, visible on HashScan. This de-risks the whole project early.
- **Day 2:** Escrow release mechanism — either the HSCS contract, or the lighter-weight backend-triggered HTS transfer gated on the confirmed HCS verdict. Wire the release condition end to end.
- **Day 3:** Next.js frontend — contract creation flow, live status, and the public verification page that reads the HCS topic via the mirror node and recomputes the hash.
- **Prep session (30 Sept):** get explicit feedback on whether judges expect a full HSCS smart contract or whether a well-integrated HCS + HTS flow without a contract is acceptable — this materially changes Day 2 scope, so resolve it before committing engineering time.

## 11. Demo and pitch script

1. Client creates a contract, funds escrow — show the HBAR/HTS balance lock on HashScan.
2. Freelancer submits work.
3. Agent evaluates live on stage; verdict + hash post to HCS — pull up the mirror node explorer in real time so judges see it land.
4. Funds auto-release.
5. Stage a dispute: demonstrate a scenario where a verdict display is altered after the fact, and show the mismatch getting caught against the immutable HCS record. This is the strongest moment for the innovation and real-world-impact scores, and the part competitors are least likely to have built.

## 12. Risks and open questions

- **HSCS vs. backend-gated HTS transfer:** unresolved scope decision — raise at the 30 September prep session before committing Day 2 engineering time.
- **Agent reliability / gameability:** judges may ask what stops the evaluation agent from being biased or gamed. Mitigation: a confidence threshold below which the system routes to human review, logged through the same HCS mechanism.
- **Time constraint:** three build days is tight for a full HSCS contract plus frontend polish. Fallback: ship the HCS + HTS flow first (this alone is a complete, demoable, genuinely Hedera-native project) and treat the smart contract layer as a stretch goal.
- **Format/date details on 4Hacks platform:** the listed submission deadline (10 October, 19:00) differs from the Campus Hackathon date (3 October) — confirm with organizers whether the campus presentation is the actual deadline or whether there's a window between presentation and final submission.

## 13. Differentiation and real-world impact

Most AI-escrow concepts stop at "a smart contract holds the money until an AI approves it." This project adds the layer that makes such a system defensible in a real dispute: the AI's own judgment becomes independently checkable, not just its outcome. That pattern generalizes beyond freelance payments to any AI-gated decision with financial or credentialing consequences — automated grading, automated QA sign-off, agent-to-agent task verification — making the core mechanism (verdict + hash → HCS → gated release) a reusable building block rather than a single-purpose demo.
