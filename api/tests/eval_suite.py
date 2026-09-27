"""Evaluator suite (T1.9) on the 6 pairs in docs/06-DEMO-CONTENT.md, against the real model.

Not a pytest module (it needs Ollama and takes minutes). Run from api/:
    .venv/Scripts/python -m tests.eval_suite                      # T1.9: all 6 cases x 3 runs
    .venv/Scripts/python -m tests.eval_suite --cases S1,S2,S3 --runs 1   # T1.8 check

Pass criteria (06 §5): >= 5/6 correct on every run; S3 always flagged; no case flips between runs.
Exit code 0 when they hold for the cases selected, 1 otherwise.
"""
import argparse
import asyncio
import sys
import time

from app.services import evaluator
from tests.demo_content import load_cases


def keep_awake() -> None:
    """Stop Windows sleeping while this process runs (process-scoped; no setting changed)."""
    if sys.platform == "win32":
        import ctypes
        ctypes.windll.kernel32.SetThreadExecutionState(0x80000001)  # ES_CONTINUOUS | ES_SYSTEM_REQUIRED


async def main() -> int:
    keep_awake()
    ap = argparse.ArgumentParser()
    ap.add_argument("--cases", default="S1,S2,S3,E4,E5,E6")
    ap.add_argument("--runs", type=int, default=3)
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()

    cases = load_cases()
    ids = args.cases.split(",")
    missing = [i for i in ids if i not in cases]
    if missing:
        print(f"unknown cases: {missing}; available: {sorted(cases)}")
        return 2

    print(f"model: {await evaluator.model_version()}")
    t0 = time.perf_counter()
    await evaluator.warm_up()
    print(f"warm-up: {time.perf_counter() - t0:.1f} s\n")

    verdicts: dict[str, list[str]] = {i: [] for i in ids}
    ok = True
    for run in range(1, args.runs + 1):
        correct = 0
        print(f"--- run {run}")
        for cid in ids:
            c = cases[cid]
            t = time.perf_counter()
            o = await evaluator.evaluate(c.sow, c.deliverable)
            dt = time.perf_counter() - t
            verdicts[cid].append(o.verdict)
            hit = o.verdict == c.expected
            correct += hit
            met = "-" if o.results is None else f"{sum(r['met'] for r in o.results)}/{len(o.results)}"
            flag = "INJ" if o.injection_suspected else "   "
            err = " EVALUATION_ERROR" if o.evaluation_error else ""
            print(f"{'OK ' if hit else 'BAD'} {cid} expected={c.expected:4} got={o.verdict:4} {flag} "
                  f"met={met:5} conf={o.confidence} crit={len(o.criteria)} attempts={o.attempts} {dt:5.1f}s{err}")
            if args.verbose or not hit:
                for cr, r in zip(o.criteria, o.results or [{}] * len(o.criteria)):
                    print(f"      {cr['id']} req={cr['required']!s:5} met={r.get('met')!s:5} {cr['description'][:90]}")
                for f in o.failures:
                    print(f"      ! {f}")
            if c.injection and not o.injection_suspected:
                print(f"      ! {cid} not flagged as injection")
                ok = False
        need = len(ids) - 1 if len(ids) == 6 else len(ids)
        print(f"run {run}: {correct}/{len(ids)} correct (need {need})")
        ok &= correct >= need

    flips = [cid for cid, v in verdicts.items() if len(set(v)) > 1]
    if flips:
        print(f"\nflipped between runs: {flips}")
        ok = False
    print(f"\n{'PASS' if ok else 'FAIL'} (total {time.perf_counter() - t0:.0f} s)")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
