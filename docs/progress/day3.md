# Day 3 report (in progress)

*27 Sep 2026. Pre-Day 3 fixes are done and committed. T3.1 and T3.2 are written and type-check, but not yet verified. Paused for the stack to be started with `scripts\start-all.ps1 -Dev`.*

## Done

| Item | Commit | Check |
| --- | --- | --- |
| Pre-Day 3 fixes (5) | `c0cc347` | pytest 41/41. `test_criteria_once.py`: funding returns in 47 ms; a deliverable 1 s after funding → Ollama calls `{criteria: 1, evaluation: 1}`. With the wait removed, the same test fails with `criteria: 2`. `forced_eval_error` is `False` when unset and `True` with `OLLAMA_EVAL_NUM_PREDICT=8` |
| Tooling | `56e97db` | `scripts/start-all.ps1` parses under PS 5.1 and is ASCII-only; `pnpm --filter web stage` = `next build && next start` |

## In progress

- **T3.1:** layout, nav, persona switcher, health footer, HashScan pill, status badge. Type-checks, and `next build` compiles.
- **T3.2:** `/verify` and `/verify/[escrowId]`, plus `canonical/hcs` reassembly (vitest 20/20).
  - Mirror CORS: `access-control-allow-origin: *`, so no proxy is needed.
  - The mirror `contracts/call` read of escrow #10 returns a `verdictHash` equal to the DB `record_hash`.

## Deviations from the docs so far

1. **`OLLAMA_WARM_UP` setting (default on).** `start-all -Dev` turns it off, so the startup warm-up prompt doesn't reload the 7B model while the UI is being built.
2. **Tests run on a separate `vte_test` database** (`api/tests/conftest.py`), so the Day 2 demo rows are never touched.
3. **`canonical/hcs` is a subpath export** (`packages/canonical/src/hcs.ts`), so `index.ts` stays byte-identical to TRD §5.3. No doc gives code for it; it ports `mirror.py`'s rules, and its tests mirror `test_mirror.py`.
4. **HashScan links for EVM tx hashes go by consensus timestamp,** looked up at mirror `/contracts/results/{hash}` (TRD §11 fallback). HashScan returns 404 for the raw hash.
5. **The verify page also goes red if `api` reports a contract address** other than the bundled one, alongside App Flow's unexpected-topic state.
6. **`ethers` v6 added to `web`.** It reads `escrows(id)` in the evidence panel; TRD §11 names `ethers.Interface` for this.

## Environment notes

- **Free RAM at session start was 1.0 GB** with the 7B model loaded; 3.7 GB after `ollama stop`.
- **Docker also runs about 19 Supabase containers** (`exam_scanner`, `quizapp`) plus `mongodb` from other projects. They add to WSL memory (`vmmemWSL` ≈ 2 GB). Stopping them before T3.8 would free RAM; I haven't touched them.
- **The DB has only RELEASED and REFUNDED contracts.** There is no HELD, ERROR, DRAFT or FUNDED example, so those screens will be exercised with a fresh contract created through the UI at T3.5.
