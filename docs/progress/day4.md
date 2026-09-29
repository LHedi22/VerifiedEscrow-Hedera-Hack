# Day 4 report

> **Decision (29 Sep, later):** about 50 s is accepted. NFR-2 (≤ 60 s) is met. **≤ 40 s was a stretch target**; measured 47–53 s deliverable → Paid over three production-build runs. No model change. The rest of this first part is the report as written when I stopped; part 2 below follows the decision.

## Part 1: stopped on the ≤ 40 s stretch target

*29 Sep 2026, evening. Both speed and memory fixes are in. The ≤ 40 s deliverable → Paid target is still missed: the three production-build runs took 47–53 s. That's a stop condition, so the pulled-forward P1 work (T5.2, T5.1, T4.3, T4.4, T4.5, T5.3, T5.5) was **not** done, apart from unverified T5.1/T4.3 code parked on a branch. No model was changed.*

## Done

| Item | Commit | Check |
| --- | --- | --- |
| Criteria cache by `sow_hash` | `8d9faf1` | New test: a second contract with the same SOW makes 0 extra criteria calls and gets the timeline entry "Criteria reused from an identical SOW (escrow #515151)"; pytest 43/43. In all 3 live runs the timeline shows `criteria_reused` at funding. TRD §8.2 and App Flow §5.3 updated. The stepper shows "Reading the SOW…" / "✓ Criteria ready" under Funded and Evaluating |
| Docker memory | not in the repo (`%USERPROFILE%\.wslconfig`) | See RAM below |
| Docs | `209236b` | App Flow §9: stay on HashScan until "✓ Criteria ready"; step 4 = measured **0:40** (total 4:10). Plan §10: `pnpm --filter hedera-svc recycle`; close VS Code, Claude Code and heavy apps; production build only; free RAM ≥ 2 GB |
| T5.1 + T4.3 (partial) | `9f23a6e` on branch **`wip/t5.1-t4.3`**, not merged | Written; `tsc` is clean. **Not verified or deployed.** The running production build doesn't include it |
| Final state | — | `reset.ps1` restored S1/S2/S3; recycle moved 14.99 ℏ back to the client; `/health` all ok with `forced_eval_error: false`; production stack running |

## Timing: steps 3–5, production build, model warm, criteria reused

`scripts/ui/e2e_flow.py S1 good none`, three times in a row (29 Sep, 19:07–19:11 UTC). Raw log: `docs/progress/day4/timing-runs.log`.

| Run | Escrow | Evaluating | Anchoring | Confirming | Verdict | **Deliverable → Paid** |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | #19 | 34 s | 2 s | 5 s | 9 s | **52.7 s** |
| 2 | #20 | 35 s | 4 s | 2 s | 7 s | **46.9 s** |
| 3 | #21 | 33 s | 0 s | 4 s | 10 s | **50.4 s** |

The API timeline gives submit → released as 48 s, 47 s and 47 s. The browser figures above include polling latency.

**Why ≤ 40 s is missed:**
- **The criteria fix worked.** Evaluating is now the evaluation call alone. It was 53 s on Day 3, which included waiting for criteria extraction.
- **The evaluation call itself takes 33–35 s.** T0.2 measured 29 s on a quieter machine.
- **The chain steps add 13–16 s after it:** anchoring 0–4 s, mirror confirmation 2–5 s, verdict transaction 7–10 s.
- **To reach 40 s, evaluation would need to take about 22–25 s.** No configuration change I'm allowed to make gets there.

**Options for you to decide** (I tried none of them):
1. **Accept about 50 s.** The run sheet now budgets it: step 4 = 0:40, step 5 = 0:15, and the 90 s stall fallback is untouched.
2. **Shorter model output.** Cap reasoning or lower `num_predict`: fewer tokens means proportionally less time. This changes the prompt and TRD §8.1–8.2.
3. **`qwen2.5:3b-instruct`.** This is TRD §8.1 fallback 2 and needs the evaluator suite re-run. It's a model change, so it's your call.
4. **Small chain savings, about 1–3 s:** skip the `escrow_get` read before `submitVerdict` on a first attempt, and poll the mirror faster than every 1 s.

## RAM

| When | Free (of 15.4 GB) | Notes |
| --- | --- | --- |
| Before (no `.wslconfig`, production stack up, 7B loaded) | **1.78 GB** | `vmmemWSL` 779 MB with only Postgres running; 1.72 GB before T3.8 on Day 3 |
| `memory=1536MB` as asked | — | The Docker engine didn't come up for more than 14 min. Inside the VM: 1397 MB total, 69 MB free, memory pressure "full" 52%. The VM is shared with `podman-machine-default` and `Ubuntu` (started by Docker's WSL integration). The Ubuntu proxy timed out ("not started after 4 minutes") |
| After (`memory=2GB`, `swap=2GB`, production stack, 7B loaded and warm) | **2.07 GB** | The engine came up in 10 s; `vmmemWSL` 1625 MB |
| End of session (after 3 Playwright runs) | 1.38 GB | It fluctuates; Windows is paging |

- **The 2 GB cap is a deviation.** 1.5 GB starved the shared WSL VM.
- **Stopping podman or Ubuntu would have freed more,** but they aren't mine, so I didn't.
- **Every `wsl --shutdown` also stops `podman-machine-default` and `Ubuntu`.** Both came back on their own.

**Containers:** only `hederahack-db-1` is running.
- `mongodb` has `restart=always`, so it came back after the Docker restart. I stopped it again.
- It will return after every Docker restart unless its policy is changed. That's your project, so I didn't change it.

## Not done (stop condition)

- **T5.2 replay fallback** (FR-29): not started.
- **T5.1 oracle-consistency row and T4.3 topic scan:** code on `wip/t5.1-t4.3`, unverified.
  - The 4 checks, "Escrow contract / HCS / App" row, topic scan, multiple-records red state, and the deleted-rows "Hedera holds an anchored record" state are all written.
  - The "Done when" checks haven't run: pass on S1/S2/S3, ✓/✓/✗ after tamper, and S2 rows deleted on a backup-then-`reset.ps1` flow.
  - Merge only after those checks pass.
- **T4.4 chips:** the injection and replay chips and the Insert sample menu already exist from T3.5; only the formal check is left.
- **T4.5 dispute UI, T5.3 projector polish, T5.5 README:** not started.

## Deviations

1. **`.wslconfig` `memory=2GB`** instead of `1536MB` (see RAM).
2. **Criteria reuse is also tried in the evaluation-step fallback,** not only at funding. It matters if funding-time extraction failed or `api` restarted.
3. **The stepper's criteria line is shown under Funded as well as Evaluating,** so the run sheet's "stay on HashScan until ✓ Criteria ready" is visible before submitting.
4. **The run sheet total went from 4:15 to 4:10,** from the measured step 4.

## Services left running

- **Production stack** (hedera-svc, api, `next start`): each in its own window, started by `scripts\start-all.ps1`.
- **Postgres** in Docker.
- **Ollama** with the 7B loaded (`Forever`).

## Balances

| Account | Balance |
| --- | --- |
| client | 68.12 ℏ |
| freelancer | 3.01 ℏ |
| arbitrator | 14.59 ℏ |
| oracle | 893.67 ℏ |

## Part 2: after the decision (29 Sep, 20:15–20:55)

### Commits

| Commit | What | Check output |
| --- | --- | --- |
| `dd0610c` | Docs: accept ~50 s — TRD §17 (measured 47–53 s, NFR-2 met, 40 s stretch), App Flow §9 fallbacks (expected pace; "Ollama slow or down → restart api with `DEMO_REPLAY=1`"), Plan §10 `docker stop mongodb` after any Docker restart | — |
| `1e1226c` | Tooling: `start-all.ps1 -Only <svc>` and `-Replay`; `stop-all.ps1` (stops only start-all's own `vte …` windows) | Both parse under PS 5.1, ASCII-only |
| `8b220dd` | **T5.1** oracle-consistency check (FR-25) | See below |
| `e1d81b4` | **T4.3** topic scan (FR-30) | See below |
| `ea9247d` | **T5.2** replay fallback (FR-29) | See below |
| `1a304e1` | **T4.4** chips + Insert sample (check only; UI from T3.5/T5.2) | See below |
| `11c800a` | **T4.5** dispute flag | See below |
| `b0e86b2` | **T5.3** projector polish | See below |
| `a30af98` | **T5.5** README | All 16 HashScan links resolve on the mirror node (HTTP 200) |
| `dd9827e` on branch **`opt2-short-output`** | Option 2, **not adopted** | See below |

`wip/t5.1-t4.3` was verified, merged as the two separate commits `8b220dd` and `e1d81b4`, and then deleted. `main`'s `web/` is identical to the verified branch.

### Check outputs

**T5.1** (`scripts/ui/oracle_check.py`, production build):

```
escrow #15: MATCH   row: Escrow contract ✓ / HCS ✓ / App ✓   checks 4/4 ✓   anchored panel: Verdict PASS
escrow #16: MATCH   row: Escrow contract ✓ / HCS ✓ / App ✓   checks 4/4 ✓   anchored panel: Verdict FAIL
escrow #17: MATCH   row: Escrow contract ✓ / HCS ✓ / App ✓   checks 4/4 ✓   anchored panel: Verdict FAIL
after \i /demo/tamper.sql:
escrow #16: MISMATCH  row: Escrow contract ✓ / HCS ✓ / App ✗  checks 4/4 ✓ (against the anchored record)  anchored panel: Verdict FAIL
```

**T4.3:**

```
backup demo/backup-20260929-202541.dump; DELETE FROM contracts WHERE escrow_id = 16 → 0 rows left; api /verify/16 → 404
escrow #16: FOUND_ON_HEDERA  row: Escrow contract ✓ / HCS ✓ / App —  checks 4/4  scan: 1 distinct record  anchored panel: Verdict FAIL
reset.ps1 → escrow #16: MATCH, ✓ / ✓ / ✓
scan_states.py (injected mirror messages):
  different second record → MULTIPLE_RECORDS "(2). The one matching the on-chain verdictHash (03f3…ed17) is authoritative."
  identical resubmission  → MATCH, "1 distinct record for escrow #16 (identical resubmissions merged)"
```

**T5.2** (replay):
- **Recording:** S1's real evaluation (contract 1, escrow #15), recorded into `api/app/replay/recordings.json`.
- **Unit test:** `DEMO_REPLAY` with Ollama fully offline gives `replay/ollama/qwen2.5:7b-instruct@845dbda0ea48`, verdict pass; pytest 44/44.
- **Testnet end to end, once,** with `start-all -Only api -Replay` and the 7B unloaded (`ollama ps` empty before and after):

  | Step | Time |
  | --- | --- |
  | submitted → evaluated | +0.06 s |
  | → anchored | +1.9 s |
  | → confirmed | +2.1 s |
  | → released | +7.5 s |
  | **deliverable → Paid** | **11.6 s** (escrow #22) |

- **Verify:** `/verify/22` is MATCH with oracle checks 4/4. `/health` shows `replay_mode: true`. The footer shows "REPLAY MODE (DEMO_REPLAY=1)…". The contract and verify pages show the "Replayed verdict (demo fallback)" chip.
- **Links:** [funding](https://hashscan.io/testnet/transaction/1790710296.080613743) · [HCS seq 30–31](https://hashscan.io/testnet/transaction/0.0.10742743-1790710300-326777533) · [verdict](https://hashscan.io/testnet/transaction/1790710312.880653460)

**T4.4:**

```
S3 injection chip: "Deliverable contained instructions aimed at the evaluator."
replay chip (escrow #22's contract): "Replayed verdict (demo fallback)"
Insert sample → good: 934 chars = S1 deliverable; → weak: 686 chars = S2 deliverable
```

**T4.5:**

```
client flags RELEASED S1 → header chip "Disputed"; timeline "Disputed by the client"; banner "Verify this record →" /verify/15;
"Flag as disputed" link gone; DB disputed = t with the reason. reset.ps1 after.
```

**T5.3** (1280 px projector at 125 % = 1024 CSS px):
- no horizontal overflow on the detail, verify or dashboard pages;
- stepper durations moved to their own line, so they no longer overlap the next step;
- verify checklist lines stay next to their checkbox;
- the "Escrow contract / HCS / App" row fits on one line (38.5 px);
- copy buttons added to the tx pills.

Before and after screenshots: `docs/progress/day4/t5.3-*`.

### Option 2 (shorter output): not adopted

The branch `opt2-short-output` changes the prompt (evidence ≤ 150 characters, reasoning ≤ 600) and sets the evaluation `num_predict` to 700 (it was 1200).

| eval_suite | S1 | S2 | S3 | E4 | E5 | E6 |
| --- | --- | --- | --- | --- | --- | --- |
| run 1 | ✓ pass | ✓ fail | ✓ fail, flagged | ✓ pass | ✓ pass | ✓ fail |
| run 2 | **✗ fail** (met 4/5; expected pass) | stopped | | | | |

- **Adoption required 6/6 on all 3 runs,** so after S1 flipped in run 2 I stopped the suite (my own job) and skipped the live runs.
- **Timing:** per-case times on the branch were 39–62 s for both steps, with no visible gain over main's 42–55 s from T1.9.
- **Why little gain was expected:** the real outputs were already short. Reasoning in the seeds is 84–232 characters and the longest evidence string is 187, so the time goes on processing the input prompt, not on output.
- **`main` keeps the original prompt and 1200.** Log: `docs/progress/day4/option2-eval-suite.log` on the branch.

### Deviations (part 2)

1. **T5.2 replay:**
   - The deliverable endpoint skips its Ollama health check when a recording matches.
   - `DEMO_REPLAY=1` skips the api's startup warm-up.
   - With no matching recording, it evaluates live and logs a warning.
   - Documented as TRD §8.3a.
2. **The contract page's "Evaluator offline" submit block is lifted in replay mode.**
3. **`scripts/ui/e2e_flow.py` and `run_sheet.py` accept any post-submit state.** A replayed verdict leaves EVALUATING within one poll.
4. **T4.4 has no new code:** the chips and menu shipped with T3.5 and T5.2, and this commit carries only the check.
5. **The consistency row shows "App —" when the app has no record** (the deleted-rows case). App Flow §5.6 doesn't specify this state.

### Final state

- **DB:** `reset.ps1` restored the seeds. S1/S2/S3 verify MATCH with Escrow contract ✓ / HCS ✓ / App ✓.
- **Recycle:** moved 4.99 ℏ back to the client.
- **Running:** the production stack (hedera-svc, api in normal mode, `next start` built from `main`) in its own windows; Postgres; Ollama with the 7B warm (`Forever`). Only `hederahack-db-1` runs in Docker.
- **Balances:**

  | Account | Balance |
  | --- | --- |
  | client | 67.94 ℏ |
  | freelancer | 3.01 ℏ |
  | arbitrator | 14.59 ℏ |
  | oracle | 893.55 ℏ |

- **Free RAM:** 1.79 GB with everything up and the model loaded.
