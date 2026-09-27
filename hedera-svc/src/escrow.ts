/**
 * Contract calls through the Hashio JSON-RPC relay (TRD §3, §7.3, Schema §6).
 * - one ethers.Wallet per persona, one mutex per signer (nonces);
 * - explicit gasLimit 400,000;
 * - value sent as parseEther(hbar) (the relay converts weibars); on-chain amounts read as tinybars;
 * - receipts awaited with a 60 s timeout; revert reasons returned in error.reason.
 */
import { Contract, JsonRpcProvider, Wallet, isAddress, parseEther, type ContractTransactionResponse, type Log } from "ethers";
import { persona, type Role } from "./accounts.js";
import { config, deployment } from "./config.js";
import { HttpError } from "./hcs.js";
import { signerMutex } from "./queue.js";

const GAS_LIMIT = 400_000n;
const RECEIPT_TIMEOUT_MS = 60_000;
const STATUS = ["None", "Funded", "Released", "Held", "Refunded"] as const;
const HASH32 = /^0x[0-9a-f]{64}$/;

let provider: JsonRpcProvider | undefined;
const wallets = new Map<Role, Wallet>();

/** batchMaxCount 1: ethers batches concurrent calls by default, and Hashio answers batches with a body
 *  ethers can't parse ("could not coalesce error"). One request per HTTP call fixes it. */
function relay(): JsonRpcProvider {
  return (provider ??= new JsonRpcProvider(config.relayUrl, 296, { staticNetwork: true, batchMaxCount: 1 }));
}

function wallet(role: Role): Wallet {
  let w = wallets.get(role);
  if (!w) {
    w = new Wallet(`0x${persona(role).key.toStringRaw()}`, relay());
    wallets.set(role, w);
  }
  return w;
}

function contract(role?: Role): Contract {
  const d = deployment();
  if (!d.contractAddress || !d.abi) throw new HttpError(503, "NOT_DEPLOYED", "no contractAddress/abi in shared/deployment.json");
  return new Contract(d.contractAddress, d.abi as never, role ? wallet(role) : relay());
}

/** JSON-safe event args: bigint -> string (tinybars stay integers), addresses lowercase. */
function plain(v: unknown): unknown {
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "string" && isAddress(v)) return v.toLowerCase();
  return v;
}

function decodeEvents(c: Contract, logs: readonly Log[]) {
  const out: { name: string; args: Record<string, unknown> }[] = [];
  for (const log of logs) {
    const parsed = c.interface.parseLog(log);
    if (!parsed) continue;
    const args: Record<string, unknown> = {};
    parsed.fragment.inputs.forEach((input, i) => (args[input.name] = plain(parsed.args[i])));
    out.push({ name: parsed.name, args });
  }
  return out;
}

function revertReason(e: any): string | undefined {
  const relayBody = typeof e?.info?.responseBody === "string"
    ? ` | relay: ${e.info.responseBody.replace(/[0-9a-fA-F]{100,}/g, "<hex>").slice(0, 400)}` : "";
  return (e?.reason ?? e?.revert?.args?.[0] ?? e?.info?.error?.message ?? e?.shortMessage) + relayBody;
}

const TRANSIENT = new Set(["UNKNOWN_ERROR", "SERVER_ERROR", "NETWORK_ERROR", "TIMEOUT"]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Send one transaction as `role`, serialized per signer, and wait for the receipt.
 * - staticCall preflight: a contract revert returns its reason and nothing is sent.
 * - `retry`: transient relay errors (Hashio sometimes answers with a non-JSON-RPC body, which ethers
 *   reports as "could not coalesce error") are retried 3x with the SAME nonce, so a retry can never
 *   apply twice. Only for idempotent calls (verdict/resolve are guarded by the contract's status
 *   checks); createEscrow is never retried blindly (double-escrow risk, TRD §14).
 */
async function send(role: Role, method: string, args: unknown[], opts: { value?: bigint; retry: boolean }) {
  return signerMutex(role).run(async () => {
    const c = contract(role);
    const overrides = { gasLimit: GAS_LIMIT, ...(opts.value ? { value: opts.value } : {}) };
    try {
      await c[method].staticCall(...args, overrides);
    } catch (e) {
      throw new HttpError(409, "WOULD_REVERT", `${method} would revert`, revertReason(e));
    }
    const nonce = await wallet(role).getNonce("pending");
    // Explicit legacy gasPrice from the relay: ethers' EIP-1559 fee estimate from Hashio sometimes comes out
    // absurdly low ("Gas price '218' is below configured minimum gas price '1140000000000'").
    const gasPrice = BigInt(await relay().send("eth_gasPrice", []));
    Object.assign(overrides, { gasPrice });
    let tx: ContractTransactionResponse | undefined;
    for (let attempt = 1; !tx; attempt++) {
      try {
        tx = (await c[method](...args, { ...overrides, nonce })) as ContractTransactionResponse;
      } catch (e: any) {
        if (!opts.retry || !TRANSIENT.has(e?.code) || attempt >= 3) {
          throw new HttpError(502, "CHAIN_ERROR", `${method} rejected by the relay (attempt ${attempt})`, revertReason(e));
        }
        console.warn(`hedera-svc: ${method} attempt ${attempt} transient relay error (${e?.code}); retrying`);
        await sleep(2000 * attempt);
      }
    }
    try {
      const receipt = await tx.wait(1, RECEIPT_TIMEOUT_MS);
      if (!receipt || receipt.status !== 1) throw new Error("reverted");
      return { txHash: tx.hash.toLowerCase(), events: decodeEvents(c, receipt.logs) };
    } catch (e) {
      const timeout = (e as any)?.code === "TIMEOUT";
      throw new HttpError(timeout ? 504 : 502, timeout ? "RECEIPT_TIMEOUT" : "CHAIN_ERROR",
        timeout ? `no receipt within 60 s for ${tx.hash}` : `transaction ${tx.hash} failed`, revertReason(e));
    }
  });
}

function need(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new HttpError(400, "BAD_REQUEST", msg);
}

export async function createEscrow(body: any) {
  const { amountHbar, freelancerEvm, arbitratorEvm, sowHash } = body ?? {};
  need(typeof amountHbar === "string" && /^\d+(\.\d{1,8})?$/.test(amountHbar) && Number(amountHbar) > 0, "amountHbar must be a positive decimal string");
  need(isAddress(freelancerEvm) && isAddress(arbitratorEvm), "freelancerEvm and arbitratorEvm must be EVM addresses");
  need(HASH32.test(sowHash), "sowHash must be 0x + 64 lowercase hex");
  const r = await send("client", "createEscrow", [freelancerEvm, arbitratorEvm, sowHash], {
    value: parseEther(amountHbar), // weibars through the relay; stored on-chain as tinybars
    retry: false,
  });
  const created = r.events.find((e) => e.name === "EscrowCreated");
  if (!created) throw new HttpError(502, "CHAIN_ERROR", `no EscrowCreated event in ${r.txHash}`);
  return { txHash: r.txHash, escrowId: Number(created.args.id), events: r.events };
}

export async function submitVerdict(body: any) {
  const { escrowId, passed, verdictHash, sowHash } = body ?? {};
  need(Number.isInteger(escrowId) && escrowId > 0, "escrowId must be a positive integer");
  need(typeof passed === "boolean", "passed must be a boolean");
  need(HASH32.test(verdictHash) && HASH32.test(sowHash), "verdictHash and sowHash must be 0x + 64 lowercase hex");
  return send("oracle", "submitVerdict", [escrowId, passed, verdictHash, sowHash], { retry: true });
}

export async function resolveDispute(body: any) {
  const { escrowId, release } = body ?? {};
  need(Number.isInteger(escrowId) && escrowId > 0, "escrowId must be a positive integer");
  need(typeof release === "boolean", "release must be a boolean");
  return send("arbitrator", "resolveDispute", [escrowId, release], { retry: true });
}

export async function getEscrow(id: number) {
  need(Number.isInteger(id) && id > 0, "id must be a positive integer");
  const e = await contract().escrows(id);
  const status = STATUS[Number(e.status)];
  if (status === "None") throw new HttpError(404, "NOT_FOUND", `escrow ${id} does not exist`);
  return {
    client: e.client.toLowerCase(),
    freelancer: e.freelancer.toLowerCase(),
    arbitrator: e.arbitrator.toLowerCase(),
    sowHash: e.sowHash,
    verdictHash: e.verdictHash,
    verdictPassed: e.verdictPassed,
    amountTinybars: e.amount.toString(), // tinybars on Hedera (TRD §7.3): formatUnits(x, 8) for HBAR
    status,
  };
}
