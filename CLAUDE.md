# Verified-Then-Paid Escrow — instructions for Claude Code

Solo hackathon build for the Hedera Cross Campus Challenge (demo on 3 Oct 2026).
An AI judges a text deliverable against an SOW. The full record is anchored on HCS **before** anyone sees the verdict. A contract then releases or holds HBAR, and anyone can verify the record from the mirror node.

## Specs live in `docs/` — read the one that owns the topic before writing code

| Topic | Doc |
| --- | --- |
| Scope, priorities (P0/P1/P2), FR/NFR IDs | `docs/01-PRD.md` |
| Architecture, canonical record, HCS, contract, evaluator, state machine, trust model | `docs/02-TRD.md` |
| Screens, UI states, demo run sheet | `docs/03-APP-FLOW.md` |
| DDL, API request/response bodies, demo scripts | `docs/04-BACKEND-SCHEMA.md` |
| Schedule, task IDs (T0.x–T6.x), gates, slip rules | `docs/05-IMPLEMENTATION-PLAN.md` |
| Every SOW/deliverable for tests, seeds, demo | `docs/06-DEMO-CONTENT.md` |
| Why v1.1 decisions were made | `docs/00-REVIEW-REPORT.md` |

If docs conflict, the owner in this table wins. Tell me about the conflict; don't silently pick one.

## Working rules

- Work on **one plan task ID at a time**, e.g. "T1.2". Read its row in `05-IMPLEMENTATION-PLAN.md` and the doc sections it cites. Its "Done when" column is the acceptance test: run it and show me the output before calling the task done.
- Code blocks in the docs are **meant to be copied verbatim**: canonical.py/TS, the Solidity contract, the Hardhat tests, the DDL, `reset.*`, `tamper.sql`, and the injection regex. They were tested. Don't "improve" them without asking.
- Commit after each task with the task ID in the message (`T1.2: canonical.py + fixtures`).
- If a gate fails (T1.3, T1.11, the Day 2 gate, the Day 3 gate), stop and tell me. Don't build on top of it.

## Invariants that must never break

- Canonical record: 8 string keys, sorted, `separators=(",", ":")`, `ensure_ascii=False`, UTF-8, SHA-256 (TRD §5). Only Python normalizes, at ingestion; nothing downstream re-normalizes.
- TS hashing uses `@noble/hashes` v2 (`@noble/hashes/sha2.js`), never `crypto.subtle`.
- Verdict, reasoning, results and the `/verify` record are served **only** when `hcs_anchors.confirmed_at IS NOT NULL`.
- `/verify/:escrowId` uses the **on-chain escrow ID**. `/contracts/:id` uses the DB id.
- The browser takes the topic ID and contract address from the bundled `shared/deployment.json`, never from `api`.
- HCS submits use `executeAll` and a single-flight queue. `ethers` calls take a per-signer mutex and `gasLimit: 400000`. On-chain amounts are tinybars (`formatUnits(x, 8)`).
- Keys only in `hedera-svc/.env`, raw hex, parsed with `PrivateKey.fromStringECDSA`. Never log or return keys.
- No DB transaction stays open across an LLM or network call.
- Open files with `encoding="utf-8"` in Python.

## Stack and layout

TRD §13. Summary:

- Next.js 14 (`web`)
- FastAPI (`api`)
- Node/Express + `@hashgraph/sdk` + `ethers` v6 (`hedera-svc`)
- Hardhat, solc 0.8.24 (`contracts`)
- Postgres 16 in Docker
- Ollama `qwen2.5:7b-instruct`, run natively

It's a pnpm workspace.

## Commands

Fill in as they come to exist.

- DB: `docker compose up -d db`
- api: `cd api && uvicorn app.main:app --reload`
- hedera-svc: `pnpm --filter hedera-svc dev`
- web: `pnpm --filter web dev`
- Tests: `pytest api/tests`, `pnpm --filter canonical test`, `cd contracts && npx hardhat test`
- Demo: `demo/reset.sh` (or `reset.ps1`), `pnpm --filter hedera-svc recycle`
