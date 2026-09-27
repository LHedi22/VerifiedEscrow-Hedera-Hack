# Day 2 report: Day 2 gate passed

*27 Sep 2026. T2.1–T2.10 are done and the Day 2 gate passes. The whole business flow runs over `api` HTTP. It covers a pass, a fail with arbitration, and a forced evaluation error that ends Held on-chain. ERROR/retry and crash-resume were also exercised on testnet. Stopping here as instructed; next is Day 3 (frontend).*

## Done

| Task | Commit | "Done when" result |
| --- | --- | --- |
| T2.1 | `8b72367` | `VerifiedEscrow.sol` verbatim from TRD §7.1; compiles (solc 0.8.24, shanghai) |
| T2.2 | `bb618f9` | TRD §7.2 tests verbatim: **8 passing** |
| T2.3 | `a55551e` | Contract `0x3dc2bb3a…a4f016` (`0.0.10748102`); demo topic `0.0.10748103`; memo names the contract; submit key = oracle; no admin key |
| T2.4 | `ae3f763` | curl flows: escrow 5 create → pass → Released; escrow 6 create → fail → Held → refund → Refunded; second resolve → 409 `not under review` |
| T2.5 | `e59622c` | Typed `hedera_client.py`, used by every router |
| T2.6 | `5e79c78` | Contract created (DRAFT) and funded (escrow #7) over HTTP; wrong persona → 403; fund twice → 409 |
| T2.7 | `f9df5c1` | **(a)** contract 1 ends RELEASED with every row populated. **(b)** `api` killed mid-EVALUATING, restarted, `resumed pipelines: [1]` → RELEASED. **(c)** forced evaluation error → HELD / EVALUATION_ERROR, escrow Held on-chain |
| T2.8 | `6dd8c4c` | Arbitrator refunds a HELD contract over HTTP; `/evaluation` = `available:false` until confirmation; `evaluated` timeline entry has no verdict |
| T2.9 | `3b944c3` | `/health`: all `ok`; `hedera_svc: down` while it was stopped |
| T2.10 | `794e4b6` | Recycle moved 16.99 ℏ, then 20.0 ℏ, back to the client; the freelancer keeps 3.009 ℏ |
| **Day 2 gate** | `b8d28d3` | `scripts/day2_gate.sh pass\|fail\|error`, all OK (below); `/retry` fix |

## Day 2 gate: HTTP only (`scripts/day2_gate.sh`)

| Scenario | Contract / escrow | Path | Result |
| --- | --- | --- | --- |
| pass (S1) | 3 / #9 | create → fund → deliverable → EVALUATING → ANCHORING → CONFIRMING → SUBMITTING_VERDICT | **RELEASED** |
| fail (S2) | 4 / #10 | … → **HELD / FAILED_VERDICT** (C2, prices, missing) → arbitrator release | RELEASED |
| error (S2 text, `OLLAMA_EVAL_NUM_PREDICT=8`) | 5 / #11 | 3 capped attempts → EVALUATION_ERROR record anchored (seq 9–10) → submitted as fail → **Held on-chain** → arbitrator refund | Refunded |
| ERROR + retry | 6 / #12, 7 / #13 | `hedera-svc` stopped mid-run → ERROR at ANCHORING. Contract 6 finished by startup resume; contract 7 by `POST /retry` (202) | RELEASED |

**Integrity, contract 1 (escrow #7):** TypeScript `recordHash` of the `/verify/7` record, SHA-256 of the HCS bytes, and the on-chain `verdictHash` all equal `ea15636d51ca380f…6eb4217`.

## HashScan

| What | Link |
| --- | --- |
| VerifiedEscrow contract | https://hashscan.io/testnet/contract/0x3dc2bb3a0077426381d0afe837be9c4edba4f016 |
| Demo topic (records seq 1–14) | https://hashscan.io/testnet/topic/0.0.10748103 |
| **pass** funding (escrow #9) | https://hashscan.io/testnet/transaction/1790537339.687969104 |
| **pass** HCS record (seq 5–6) | https://hashscan.io/testnet/transaction/0.0.10742743-1790537399-692451777 |
| **pass** verdict → Released | https://hashscan.io/testnet/transaction/1790537412.093245459 |
| **fail** funding (escrow #10) | https://hashscan.io/testnet/transaction/1790537436.994135104 |
| **fail** HCS record (seq 7–8) | https://hashscan.io/testnet/transaction/0.0.10742743-1790537499-778021100 |
| **fail** verdict → Held | https://hashscan.io/testnet/transaction/1790537510.193304104 |
| **fail** arbitrator release | https://hashscan.io/testnet/transaction/1790537523.093153104 |
| **error** funding (escrow #11) | https://hashscan.io/testnet/transaction/1790537557.534469012 |
| **error** EVALUATION_ERROR record (seq 9–10) | https://hashscan.io/testnet/transaction/0.0.10742743-1790537588-606522967 |
| **error** verdict → Held | https://hashscan.io/testnet/transaction/1790537600.385793302 |
| **error** arbitrator refund | https://hashscan.io/testnet/transaction/1790537612.434484104 |
| Recycle (freelancer → client) | https://hashscan.io/testnet/transaction/0.0.10746386-1790538105-113813093 |

Day 1 links (accounts, dev topic, WhoAmI) are in `day1.md`.

## Numbers

- **Pipeline time, deliverable → RELEASED:** about 70–85 s.
  - Evaluation step: 30–60 s (criteria cached at funding).
  - Anchoring: about 3 s.
  - Mirror confirmation: 3–4 s.
  - Verdict transaction: about 10 s.
- **Contract call fee:** 0.0246 ℏ (T1.6). The oracle spent about 4 ℏ across all of Day 1–2.
- **Balances now:** oracle 894.49 ℏ, client 79.60 ℏ, freelancer 3.01 ℏ, arbitrator 14.64 ℏ. All are above the TRD §4 minimums, and the oracle is far above the 100 ℏ floor.

## Deviations from the docs, and why

1. **`hedera-svc` ↔ Hashio relay fixes** (T2.4). The TRD doesn't mention these; without them contract calls failed intermittently.
   - `batchMaxCount: 1`: ethers' default JSON-RPC batching got an unparseable reply from Hashio ("could not coalesce error").
   - Explicit legacy `gasPrice` from `eth_gasPrice`: ethers' EIP-1559 estimate sometimes came out at 218 wei, below the relay's minimum of 1.14e12, which gave HTTP 400.
   - `staticCall` preflight: a contract revert returns **409 WOULD_REVERT** with the contract's own reason (e.g. `not under review`), and nothing is sent.
   - Verdict and resolve are retried 3 times on transient relay errors with a **pinned nonce**, so a retry can't apply twice. `createEscrow` is never retried blindly, because of the double-escrow risk in TRD §14.
2. **Personas are synced from `hedera-svc /accounts` at `api` startup** when the table is empty, with Schema §8.1's names (Amira, Youssef, Nour). That's seed step 1, pulled forward from T4.2 because T2.6 can't create contracts without persona rows.
3. **Criteria at funding (TRD §8.1 fallback 1, from T0.2).** `fund` starts a background criteria extraction cached in `evaluations.criteria`, and the pipeline waits for it if the deliverable arrives first.
4. **The forced evaluation error uses configuration, not test code.** `OLLAMA_EVAL_NUM_PREDICT=8` makes every evaluation reply hit the cap, which runs the real §8.4 path. The two caps (512/1200) are now settings.
5. **Anchoring guards.** Before submitting, `_anchor` recomputes the record hash from `v_canonical_record` and refuses if it no longer matches the hash stored at evaluation. It also refuses if `hedera-svc` used any topic other than `deployment.json`'s `topicId`.
6. **`/retry` bug found and fixed** (commit `b8d28d3`).
   - It was a sync endpoint, so `asyncio.create_task` ran without an event loop and returned 500, after the DB had already moved to ANCHORING.
   - It's now async and verified on testnet.
   - A contract stranded that way is still recovered by startup resume, which was shown on contract 6.
7. **DB `connect_timeout` of 5 s.** After the laptop slept, Docker Desktop was down and `api` hung silently at startup; it now fails fast.
8. **`raw_output` stays null when all three attempts hit the cap.** A truncated reply isn't valid JSON, so there's nothing useful to store. The failure reasons are logged instead.
9. **Contract IDs 1–7 and escrows 1–13** exist on this deployment from testing. Seeds (T4.2) will run against a clean DB. Redeploying the contract would restart escrow IDs at 1, which needs a new topic (TRD §6).

## Environment notes

- **Docker Desktop stopped again after the laptop slept.** Check `docker version` before starting `api`.
- **RAM stays tight with the 7B model loaded.** The Next dev server wasn't started, as instructed.
- **Services still running now:** `api` on :8000, `hedera-svc` on :7000, Postgres in Docker, Ollama with the 7B model loaded.
