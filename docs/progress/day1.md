# Day 1 report: Day 1 gate passed

*27 Sep 2026. Day 0 (T0.1–T0.4) and Day 1 (T1.1–T1.11) are complete. Both hard gates (T1.3 and the Day 1 gate, T1.11) passed on the first attempt.*

## Done

| Task | Commit | "Done when" result |
| --- | --- | --- |
| T0.1 | `4ae6899` | Four ECDSA accounts, none hollow, verified on the mirror node. Funded to TRD §4 targets: client 80, freelancer 5, arbitrator 15 ℏ |
| T0.2 | `542f161` | 7B fails the full gate (65–84 s warm). **Fallback 1 (criteria at funding) passes: evaluation step 29.3 s and 29.1 s warm** |
| T0.3 | `05b8af2` | `docker compose up db` works; `pnpm -r install` clean |
| T0.4 | `7ecb6b3` | `git status` shows no `.env` |
| T1.1 | `3383c7b` | vitest 7/7; `index.ts` byte-identical to TRD §5.3 |
| T1.2 | `65aaa87` | pytest 14/14; NUL and lone surrogate rejected; 6 fixtures |
| **T1.3 (gate)** | `91edbde` | All four legs agree on 6/6 fixtures: pytest, vitest, `sha256sum`, browser `Self-test PASS (6/6)` |
| T1.4 | `ffcdc7d` | Dev topic `0.0.10746404`; submit key = oracle; no admin key |
| T1.5 | `3f4af42` | 3,363-byte record → seq 1–4 (4 chunks); link IDs resolve on the mirror node |
| T1.6 | `0df1db4` | `msg.sender` == oracle alias; 1 HBAR = `100000000`; **fee 0.0246 ℏ per call** |
| T1.7 | `a71c27d` | `alembic upgrade head` creates 7 tables, the view and 4 enums; round-trip OK |
| T1.8 | `adf9a85` | S1 pass (5/5), S2 fail on C2 (prices) only, S3 fail with the injection flagged |
| T1.9 | `209b05a` | 6/6 correct on each of 3 runs; S3 always flagged; no flips |
| T1.10 | `1d0d987` | Unit tests 7/7 (foreign chunk mixed in); confirmed the real T1.5 message by hash |
| **T1.11 (gate)** | `636a383` | S1 verdict record (1,698 bytes) → dev topic seq 5–6 → mirror hash-confirmed in 4.2 s. TS `recordHash` of the mirror bytes equals the Python hash `7fc6b7ee…12a9ef` |
| docs | `44c1395`, `c04b4cf`, `610f7fe` | v1.1 into `docs/`, `num_predict` caps, native Windows, T0.2/T4.2 wording |

## HashScan

| What | Link |
| --- | --- |
| Oracle `0.0.10742743` (896.63 ℏ) | https://hashscan.io/testnet/account/0.0.10742743 |
| Client `0.0.10746385` | https://hashscan.io/testnet/account/0.0.10746385 |
| Freelancer `0.0.10746386` | https://hashscan.io/testnet/account/0.0.10746386 |
| Arbitrator `0.0.10746388` | https://hashscan.io/testnet/account/0.0.10746388 |
| Dev topic `0.0.10746404` | https://hashscan.io/testnet/topic/0.0.10746404 |
| Day 1 gate record (seq 5–6) | https://hashscan.io/testnet/transaction/0.0.10742743-1790535840-703851137 |
| T1.5 smoke record (seq 1–4) | https://hashscan.io/testnet/transaction/0.0.10742743-1790526434-556861729 |
| WhoAmI contract | https://hashscan.io/testnet/contract/0xc4317442fa80dbd6e7504a26d900d8398b7b5748 |
| WhoAmI `echoValue` call | https://hashscan.io/testnet/transaction/1790526521.745198104 |

## Numbers

- **Speed gate, T0.2.** Laptop: GTX 1650 Ti 4 GB, with 2.2 of the model's 5.4 GB on the GPU.

  | Configuration | Warm time | Result |
  | --- | --- | --- |
  | Both steps, `num_ctx` 8192 | 65 s and 84 s | fail |
  | Both steps, `num_ctx` 4096 | 85 s | fail, no gain |
  | Criteria at funding (fallback 1), evaluation step | 29.3 s and 29.1 s | pass |

  A full suite case (both steps) takes 42–55 s.
- **Fee per contract call (T1.6):** 0.0246 ℏ at `gasLimit` 400,000 (gas used 22,542). The deploy cost 0.1071 ℏ. That's far below the 0.5 ℏ budget line, so the TRD §4 budget holds.

## Deviations from the docs, and why

1. **Evaluation prompt: one added sentence** ("confidence is a number from 0.0 to 1.0.") in `api/app/prompts/evaluation_system.txt`, with TRD §8.2 updated to match.
   - The 7B model returned `confidence: 100`, a 0–100 scale. Under §8.4 that's a failed attempt, so every live evaluation would have ended as EVALUATION_ERROR.
   - Ollama doesn't enforce the schema's `minimum`/`maximum`.
2. **Criteria extraction at funding time (TRD §8.1 fallback 1).** The 7B model can't do both steps in ≤ 40 s on this laptop.
   - **T2.7's pipeline must run step 1 when the contract is funded** and cache it in `evaluations.criteria`.
   - The 7B model stays, and `num_ctx` stays 8192.
3. **Criteria-extraction prompt written by me.** TRD §8.2 gives only its schema.
4. **`create-accounts.ts` finalizes hollow accounts.** EVM-address auto-creation makes keyless accounts, so each new account pays 1 tinybar back to the oracle, which gives it its key. This keeps TRD §4's "ECDSA accounts with EVM aliases" true.
5. **Separate `devTopicId` in `shared/deployment.json`,** with a guard:
   - `hedera-svc` uses it only while there is no `topicId`, and logs which topic it uses at startup.
   - `api`'s `settings.topic_id` reads only `topicId`.
   - `deploy.ts` (T2.3) rewrites the file with the TRD's keys, so the dev fallback disappears after deploy.
6. **Hardhat network renamed to `hederaTestnet`** (TRD §7.5). My T0.3 scaffold had called it `testnet`.
7. **Explicit devDependencies in `contracts`** for `ethers`, `hardhat-ethers` and typechain. pnpm's strict layout hid the auto-installed toolbox peers from TypeScript.
8. **`packages/canonical` also exports `hashscanUrl`/`mirrorTxId`** (TRD §11's helper), so `web` and `hedera-svc` share one implementation.
9. **`speed-gate.ps1` and `eval_suite.py` keep Windows awake while they run.** The laptop slept mid-run once (17:41–19:36), which produced a fake 6,963 s timing. It's process-scoped; no power setting was changed.
10. **`num_ctx` is now a setting** (`OLLAMA_NUM_CTX`, default 8192) rather than a constant.

## Environment notes

- **RAM is tight.** The machine has 15.4 GB; with the 7B model loaded (4.3 GB) and the browser (3.8 GB), free RAM dropped to 1.4–2.9 GB.
- **Background jobs were killed.** Claude Code stopped them under memory pressure once: the first 7B pull, the Next dev server and a watcher. Per your instruction, the Next dev server isn't started while Ollama is loaded.
- **The laptop sleeps during long idle runs.** Keep it plugged in and awake for rehearsals.
