/**
 * T2.10 (Schema §8.5): move the freelancer's balance above 3 ℏ back to the client, with an SDK
 * TransferTransaction paid and signed by the freelancer. Run after each rehearsal.
 *
 *   pnpm --filter hedera-svc recycle
 */
import { Client, Hbar, TransferTransaction } from "@hashgraph/sdk";
import { persona } from "../src/accounts.js";
import { config } from "../src/config.js";

const KEEP_TINYBARS = 3n * 100_000_000n; // keep 3 ℏ for the freelancer's own fees
const FEE_RESERVE_TINYBARS = 1_000_000n; // 0.01 ℏ headroom for this transfer's fee

async function balance(accountId: string): Promise<bigint> {
  const r = await fetch(`${config.mirrorUrl}/api/v1/accounts/${accountId}`);
  if (!r.ok) throw new Error(`mirror HTTP ${r.status}`);
  return BigInt(((await r.json()) as { balance: { balance: number } }).balance.balance);
}

async function main() {
  const freelancer = persona("freelancer");
  const client = persona("client");
  const before = { f: await balance(freelancer.accountId.toString()), c: await balance(client.accountId.toString()) };
  const amount = before.f - KEEP_TINYBARS - FEE_RESERVE_TINYBARS;
  console.log(`freelancer ${freelancer.accountId}: ${Number(before.f) / 1e8} ℏ; client ${client.accountId}: ${Number(before.c) / 1e8} ℏ`);
  if (amount <= 0n) {
    console.log("nothing to recycle (freelancer at or below 3 ℏ)");
    return;
  }

  const sdk = Client.forName(config.network).setOperator(freelancer.accountId, freelancer.key); // freelancer pays and signs
  const resp = await new TransferTransaction()
    .addHbarTransfer(freelancer.accountId, Hbar.fromTinybars((-amount).toString()))
    .addHbarTransfer(client.accountId, Hbar.fromTinybars(amount.toString()))
    .setTransactionMemo("vte recycle: freelancer -> client")
    .execute(sdk);
  const receipt = await resp.getReceipt(sdk);
  sdk.close();
  const txId = resp.transactionId.toString();
  const [acct, start] = txId.split("@");
  const [secs, nanos] = start.split(".");
  console.log(`moved ${Number(amount) / 1e8} ℏ: ${receipt.status}  https://hashscan.io/testnet/transaction/${acct}-${secs}-${nanos.padEnd(9, "0")}`);

  await new Promise((r) => setTimeout(r, 6000)); // let the mirror node catch up
  const after = { f: await balance(freelancer.accountId.toString()), c: await balance(client.accountId.toString()) };
  console.log(`after: freelancer ${Number(after.f) / 1e8} ℏ, client ${Number(after.c) / 1e8} ℏ`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
