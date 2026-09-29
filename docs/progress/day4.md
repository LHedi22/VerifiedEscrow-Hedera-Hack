# Day 4 report: stopped on the ≤ 40 s stage target

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
