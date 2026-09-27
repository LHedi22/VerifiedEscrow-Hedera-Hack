# Review Report — Verified-Then-Paid Escrow docs 01–05

*Review · 26 Sep 2026 · covers `01-PRD.md` … `05-IMPLEMENTATION-PLAN.md` v1.0 → v1.1, plus the new `06-DEMO-CONTENT.md`*

---

## Bottom line

The v1.0 set was strong: coherent, honest in tone, well-sequenced, with the right demo moment. But it had **5 critical problems** and **9 high ones**:

- The critical ones would have broken the demo on stage, left funds stuck, or made a trust claim false in front of judges.
- The high ones would each have cost hours during the build week.

In total there are **47 findings**. All are fixed in the v1.1 documents now in the Project, except the handful listed under "Still open" at the end, which only you can resolve (faucet, laptop speed, slot length…).

Where a claim could be tested, it was run rather than reasoned about:

| What | How it was checked | Result |
| --- | --- | --- |
| Revised contract | Compiled with solc 0.8.24; ran the 8 Hardhat tests now in TRD §7.2 | All pass |
| Canonical JSON, Python vs JS | Ran the TRD reference code on every ASCII control char, DEL, U+0085/00A0/2028/2029/FEFF, combining marks, Arabic, a ZWJ emoji, U+10FFFF | **Byte-identical**; `sha256sum` and `@noble/hashes` agree |
| Normalization | Same harness | **Python `rstrip()` and JS `trimEnd()` strip different characters**; Python lets NUL through; `isoformat()` gives `+00:00`, not `Z` |
| Schema, tamper, reset | Ran v1.1 DDL on Postgres 16; 6 bad-data probes; `tamper.sql`; snapshot/reset twice | DDL clean; all probes rejected; tamper changes the hash; reset restores the **identical** hash; tamper fails loudly if S2 is missing |
| HCS chunking | Read `@hashgraph/sdk` 2.81.0 source | `execute()` returns only chunk 1's response; chunk size 1024; max 20 |
| HIP-478 | Read the HIP | Status Accepted; direct topic reads are a *Rejected Idea* — "possible", rejected for consistency, oracle route recommended |
| Faucet and testnet resets | Hedera faucet page, 2024 Portal announcement, testnet docs | Faucet page now says **10 ℏ/day**; resets are periodic with 2–4 weeks' notice |
| Injection backstop | New regex tested on all 6 demo deliverables + false-positive probes | Only S3 flagged; "Our AI: …", "AI Night: …" not flagged |
| Demo texts | Lengths, headline words, `!`, record size computed in code | All within limits; records 3.7–4.6 KB (4–5 chunks) at the reasoning cap |
| `@noble/hashes` import | Installed v2.4.0 | The v1-style path `@noble/hashes/sha256` **throws**; v1.1 uses `sha2.js` |

## The five critical findings

**1. An evaluation error left the money stuck.**

- *What v1.0 did:* FR-9 moved the contract to `HELD` in the app when the model returned bad output three times. But nothing was sent on-chain, so the escrow stayed `Funded`.
- *Why it breaks:* `resolveDispute` requires `Held`, so the arbitrator's button would revert with "not under review". The HBAR had no way out.
- *Fix (TRD §8.4, PRD FR-9):* the error path now anchors an honest fail record (`reasoning: "EVALUATION_ERROR: …"`) and calls `submitVerdict(false)`. The escrow becomes `Held` on-chain like any fail. An unreachable evaluator is a separate case: it pauses the contract in `ERROR` and can be retried.

**2. The HIP-478 line was wrong, and it was the closing line of the pitch.**

- *What v1.0 said:* HIP-478 says contracts can't read HCS "because EVM execution must be deterministic", and "contracts can't read HCS by design".
- *What HIP-478 actually says:* it is *Accepted*, proposes contract↔HCS interaction **through an oracle network**, and lists direct reads under Rejected Ideas: *possible*, but rejected for consistency.
- *Fix:* corrected in every document, with a new closing line (App Flow §9, step 10). It's a stronger line now: your design *is* the pattern HIP-478 recommends, plus a public check on the oracle.

**3. "The oracle's honesty is publicly checkable" wasn't actually checked.**

- *What v1.0 did:* the P0 check compared the DB record with the HCS record at sequence numbers **supplied by the backend**. The on-chain cross-check was P2, and it compared only the hash. The contract didn't store pass/fail at all.
- *Why it breaks:* an operator who holds the oracle key (the same operator the demo casts as malicious) can post a second, doctored record, point the app at it, and get a **green** MATCH.
- *Fix:*
  - The contract now stores `verdictPassed`.
  - FR-25 is **P1** and checks four things: hash, pass/fail, SOW hash, and that the escrow exists.
  - The topic scan (new FR-30) flags two different records for one escrow.
  - The trust model (TRD §15) lists this attack explicitly.

**4. The verification page took the topic ID from the backend it was supposed to check.**

- *Why it breaks:* a dishonest backend could point the "independent" check at its own topic.
- *Fix:* topic ID and contract address come from `shared/deployment.json`, **bundled into the web build**. The page also checks that the anchored record's `contract_id` equals the escrow being verified.

**5. The verdict could be revealed before it was anchored, and the three documents disagreed about when.**

- *What v1.0 said:* the TRD revealed it at "status ≥ CONFIRMING", the App Flow hid it through SUBMITTING_VERDICT, and the Schema said "after CONFIRMING". Meanwhile `/verify` read a view that has the verdict **as soon as evaluation finishes, before anchoring**.
- *Fix:* one rule everywhere. Nothing (verdict, reasoning, results, `/verify` record, timeline text) is served until `hcs_anchors.confirmed_at` is set, i.e. until the mirror node serves the anchored bytes and anyone can already verify them.

## All findings

Severity: **C** critical (demo, funds or a public claim breaks) · **H** high (hours lost or likely stage failure) · **M** medium (a bug you'd hit during the week) · **L** low (inconsistency or polish).

| # | Sev | Where (v1.0) | Finding | Fix in v1.1 |
| --- | --- | --- | --- | --- |
| 1 | C | PRD FR-9, TRD §8.4/§9 | Evaluation error → app HELD but escrow still Funded → arbitrator can't resolve, funds stuck | Anchor an EVALUATION_ERROR fail record and submit it; escrow Held on-chain |
| 2 | C | PRD G4/glossary, TRD §6, App Flow §9, Plan §11 | HIP-478 misquoted in the pitch close and Q&A | Accurate wording everywhere; new closing line |
| 3 | C | TRD §7/§11/§15, PRD FR-25 | Oracle honesty unchecked at P0/P1; contract didn't store pass/fail; re-anchoring attack passes | `verdictPassed`; FR-25 → P1 with 4 checks; FR-30 duplicate detection; threat listed |
| 4 | C | TRD §6.2/§11, Schema `/verify` | Browser took the topic ID from the backend | Bundled `deployment.json`; `contract_id` check; red state if the backend disagrees |
| 5 | C | TRD §9, App Flow §5.3, Schema §5.3 | Verdict revealed before anchoring (`/verify` view); inconsistent gates | Single gate on `confirmed_at`; `evaluated` timeline text carries no verdict |
| 6 | H | App Flow §5.5, Schema `/verify/{id}` | "Escrow or contract ID": DB id vs escrow id mixed; the deletion case needs the escrow ID | `/verify/:escrowId` everywhere; DB id only for `/contracts/:id` |
| 7 | H | TRD §4, Plan T0.1/T6.4 | Budget assumed ~500 ℏ; the faucet now advertises 10 ℏ/day; 25 ℏ × every rehearsal drains the client | 5 ℏ escrows, recycle script, minimum/target balances, Day 0 reality check |
| 8 | H | TRD §8.1 | Ollama unloads idle models after 5 min, so the model warmed at T-60 is cold on stage; speed never measured on the laptop | `keep_alive: -1`; Day 0 speed gate ≤ 40 s with fallbacks |
| 9 | H | Schema §8.2 | Example SOW asked for "40–80 words" per section and "250–450 words" total; a 7B model can't count, so the live PASS could fail on stage | Presence-based SOW (`06-DEMO-CONTENT.md`) |
| 10 | H | Plan T1.8/T1.9, Schema §8.2 | S2/S3 texts and the 3 extra eval pairs didn't exist, but Day 1 depended on them | `06-DEMO-CONTENT.md`, all texts checked in code |
| 11 | H | TRD §6.1 vs §10.2, Schema §6 | `execute()` returns chunk 1 only; TRD said "receipt of the final chunk" and returned `sequenceNumber` in one place, `sequenceFirst/Last` in another | `executeAll`, first/last receipts; one response shape |
| 12 | H | Schema §8.3 | `reset.sh` piped a binary dump via `<` (no such redirect in PowerShell, and PS 5 corrupts binary pipes); `pg_dump` ran on the host (version mismatch); `--clean` dropped the schema under a running `api` | Data-only snapshot inside the container, `reset.sql` + `pg_restore --data-only`, bash **and** PowerShell versions; tested on PG16 |
| 13 | H | App Flow §5.6, PRD §1 | MATCH banner claimed "the verdict the AI produced", which isn't proven (pre-anchoring is a stated limitation) | Banner claims only "unchanged since anchored, before reveal"; anchored record shown from Hedera |
| 14 | H | Plan §10–11, App Flow §9 | `psql` on stage assumed a host client and a relative path; on Windows there may be neither | `docker compose exec db psql` + `./demo` mounted, `\i /demo/tamper.sql` |
| 15 | M | TRD §6.1 | Concurrent submissions could interleave chunks; the query `gte:first&limit=25` could miss or mix them | Single-flight HCS queue; `gte`+`lte` query; reassembly rules |
| 16 | M | TRD §5.2 | Python `rstrip()` ≠ JS `trimEnd()` (tested); a TS `normalize` port would drift | Explicit ASCII strip set; normalization is Python-only |
| 17 | M | TRD §5.2 | NUL passes normalization, then Postgres rejects it → 500 mid-submit | Reject NUL + lone surrogates → 422 `INVALID_TEXT` |
| 18 | M | TRD §5.1 | No timestamp generator given; `isoformat()` yields `+00:00`, which violates the DB CHECK → pipeline crash | `record_timestamp()` in TRD §5.3 (tested) |
| 19 | M | TRD §3/§5.3 | `crypto.subtle` is undefined outside secure contexts → the verify page crashes if opened via a LAN IP | `@noble/hashes` v2 (import path verified) |
| 20 | M | TRD §9 | `SELECT … FOR UPDATE` held across a 30 s LLM call | Atomic conditional UPDATE claim; no transaction spans a call |
| 21 | M | TRD §9 | Startup resume skipped `EVALUATING` (stuck forever); resuming `SUBMITTING_VERDICT` after a landed tx reverts with "not funded" | Resume `EVALUATING`; read chain first and reconcile; `CONFIRMING` never resubmits |
| 22 | M | TRD §6 | One topic reused across redeploys + Day 1 test records → duplicate "escrow 7" records in the topic scan | One topic per deployment, created by `deploy.ts`; dev topic for Day 1 |
| 23 | M | TRD §12 | `.env` put two variables on one line (dotenv doesn't parse that); topic ID duplicated in 3 files | One per line; `deployment.json` is the single source |
| 24 | M | Schema §8.1 | Seed personas "from `.env`", but `api/.env` has no account data | `hedera-svc GET /accounts` |
| 25 | M | Schema §4, TRD §4 | DB requires lowercase EVM addresses; `ethers` returns checksummed → seed insert fails | Lowercase on insert; case-insensitive compares |
| 26 | M | TRD §4 | Portal shows DER and raw keys; `PrivateKey.fromString` can misread raw ECDSA hex as ED25519 → `INVALID_SIGNATURE` | Raw HEX key; `fromStringECDSA` |
| 27 | M | Schema §5.3 | Record-size pre-check by character count under-estimates (escaped newlines, 2-byte Arabic); reasoning length unbounded | Pre-check on real serialization; 3,000-char cap in code + DB CHECK |
| 28 | M | PRD FR-29 | Replay fallback anchored a pre-recorded verdict as if live, i.e. the very manipulation the pitch disclaims | `model_version = "replay/…"` inside the record + UI chip |
| 29 | M | TRD §15, PRD §3 | Publishing the full SOW and deliverable permanently on a public ledger is a privacy issue, never stated | Non-goal + trust-model row + Q&A answer |
| 30 | M | Plan, PRD §13 | Presentation slot length and venue internet never asked; the run sheet alone is 4:15 | Open questions 4–5; T4.1 |
| 31 | M | TRD §4 | Testnet resets (periodic, 2–4 weeks' notice) not considered | Status-page check Day 0 and Fri; scripted redeploy + reseed |
| 32 | M | TRD §18 (new) | Windows traps: Python cp1252 default, Git autocrlf on fixtures, WSL→Windows `localhost` to Ollama | `encoding="utf-8"` + `PYTHONUTF8`, `.gitattributes`, one-environment rule |
| 33 | M | Plan §11, TRD §15 | "Anyone can re-run the evaluation" needs the prompts, and LLMs aren't bit-reproducible | Prompts committed; claim phrased as evidence, not proof |
| 34 | M | Plan T1.3 | Third self-test leg was vague ("hashlib on the raw bytes" of what?) | Fixtures store expected `.canonical` bytes; `sha256sum` is the independent leg; failures give a byte diff |
| 35 | L | Contract (TRD §7.1) | No distinct-party check; zero verdict hash accepted; solc floating | Added (tests 8); solc 0.8.24 pinned, shanghai |
| 36 | L | TRD §7.3 | Nonce collisions from concurrent calls on one wallet; ≥ 80% of `gasLimit` is charged | Per-signer mutex; fee measured in T1.6 |
| 37 | L | TRD §8.2 | Criteria "cached in `acceptance_criteria`", a table that doesn't exist | `evaluations.criteria` |
| 38 | L | PRD FR-10, Plan T4.4 | Confidence threshold P1/Wednesday in PRD+Plan, but P0/Day 1 in TRD aggregation | P0, built Day 1; T4.4 is UI chips only |
| 39 | L | PRD FR-27 | "Two demo contracts"; Schema has three | Three, with asserted end states |
| 40 | L | App Flow §9 | "About 4.5 minutes"; rows sum to 4:15 | 4:15 |
| 41 | L | App Flow §5.3 | Funding tx shown as `0.0.x@…`, but funding goes through ethers (EVM hash) | `0x…` hash |
| 42 | L | TRD §5.1 vs Schema/PRD | `model_version` with and without `sha256:` prefix | One format (12 hex, no prefix) |
| 43 | L | Schema §8.4 | `tamper.sql` sub-select errors if seeds ran twice; no stop-on-error | `\gset` + `ON_ERROR_STOP` (tested) |
| 44 | L | Schema §4 | `ERROR` allowed with null escrow and unrelated `error_step`; `sequence_*` nullable though required | CHECKs tightened (tested) |
| 45 | L | App Flow §8 | "Two tabs: supported … use two profiles" contradicted itself | Separate profiles, stated plainly |
| 46 | L | TRD §1, Plan T0.3 | "Next.js 14" but `create-next-app@latest` installs a newer major (async `params`) | Pin `create-next-app@14` |
| 47 | L | Plan T4.6 | HTS receipt NFT estimate omitted token association | Included |

## Decisions I made for you (easy to reverse)

| Decision | Why | To reverse |
| --- | --- | --- |
| Demo escrow 5 ℏ (was 25) | Faucet now advertises 10 ℏ/day | If the Portal still gives 1,000 ℏ/day, 25 ℏ is fine; replace "5 ℏ" in App Flow/Schema |
| S1 SOW rewritten without word counts | A 7B model can't count reliably | Keep word counts only if T1.9 passes them 3× in a row |
| Escrow ID as the public verification key | It's inside the anchored record and on HashScan | — (recommended to keep) |
| One HCS topic per contract deployment | Escrow IDs restart on redeploy | Alternatively put the contract address inside the record |
| Verdict revealed at mirror confirmation (not at HCS receipt) | At reveal time, anyone can already verify | Revealing at receipt is also defensible; keep one rule |
| Contract gains `verdictPassed`, distinct-party and non-zero-hash checks | Needed for the oracle check; cheap | — |
| `@noble/hashes` instead of `crypto.subtle` | Works on any origin; same hash (tested) | — |

## Not applied, recommended if Day 1 finishes early (≈ 30 min each, only before real anchoring)

- **Hash the criteria/results too:** a `detail` key holding the evaluation JSON as one string, with the criteria table rendered from that string. Today the table is labelled "not anchored in v1".
- **Add `prompt_version` to the record,** so "re-run the evaluation" becomes checkable.

## Still open — only you can close these

| Item | When | Where it's tracked |
| --- | --- | --- |
| What the faucet/Portal actually gives per day | Tonight | Plan T0.1 |
| Whether a testnet reset is scheduled before 4 Oct | Tonight | Plan T0.1, T6.4 |
| Laptop speed for the 7B model (≤ 40 s gate) | Tonight | Plan T0.2 |
| Mirror-node CORS from `localhost:3000` | Day 3 (check early) | TRD §6.2 |
| HashScan link formats for EVM hashes and topic messages | Day 1 | TRD §11 |
| Slot length, venue internet/projector, HTS expectation, real deadline | 30 Sep prep session | PRD §13, Plan T4.1 |

## Spec v2 (not edited)

`hedera-verified-escrow-project-spec-v2.md` is left as it was; PRD §0 now says v1.1 docs win where they differ. Three spec statements are superseded:

- the HIP-478 reason
- "`\n` line endings" in a whitespace-free canonical JSON
- "HTS payment"

## Sources

- [HIP-478: Interoperability Between Smart Contracts and HCS](https://hips.hedera.com/hip/hip-478)
- [Hedera testnet faucet](https://portal.hedera.com/faucet)
- [Hedera blog: new testnet faucet and Portal changes (Feb 2024)](https://hedera.com/blog/introducing-a-new-testnet-faucet-and-hedera-portal-changes/)
- [Hedera docs: Testnets (reset policy, throttles)](https://docs.hedera.com/learn/networks/testnet)
- `@hashgraph/sdk` 2.81.0 source (npm), `src/topic/TopicMessageSubmitTransaction.js`
