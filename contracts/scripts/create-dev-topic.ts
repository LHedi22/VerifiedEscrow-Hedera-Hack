/**
 * T1.4: a DEV topic for Day 1-2 experiments (submit key = oracle key, no admin key).
 * The demo topic is created later by deploy.ts (T2.3). Writes devTopicId into shared/deployment.json.
 *
 *   npx ts-node scripts/create-dev-topic.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as dotenv from "dotenv";
import { AccountId, Client, PrivateKey, TopicCreateTransaction } from "@hashgraph/sdk";

dotenv.config({ path: join(__dirname, "..", "..", "hedera-svc", ".env") }); // keys live only there
const DEPLOYMENT = join(__dirname, "..", "..", "shared", "deployment.json");
const MIRROR = "https://testnet.mirrornode.hedera.com/api/v1";

async function main() {
  const id = process.env.ORACLE_ACCOUNT_ID ?? "";
  const keyHex = process.env.ORACLE_KEY ?? "";
  if (!/^0\.0\.\d+$/.test(id) || !/^0x[0-9a-fA-F]{64}$/.test(keyHex)) throw new Error("ORACLE_* not set in hedera-svc/.env");
  const key = PrivateKey.fromStringECDSA(keyHex);
  const client = Client.forTestnet().setOperator(AccountId.fromString(id), key);

  const receipt = await (
    await new TopicCreateTransaction()
      .setSubmitKey(key.publicKey) // only the oracle can post
      .setTopicMemo("vte-escrow records v1 · DEV (Day 1-2 experiments, not the demo topic)")
      .execute(client)
  ).getReceipt(client);
  client.close();
  const topicId = receipt.topicId!.toString();

  const dep = JSON.parse(readFileSync(DEPLOYMENT, "utf8"));
  dep.devTopicId = topicId;
  writeFileSync(DEPLOYMENT, JSON.stringify(dep, null, 2) + "\n", "utf8");

  // Done-when check: the mirror node shows the topic with the oracle's submit key and no admin key.
  let t: any = null;
  for (let i = 0; i < 20 && !t; i++) {
    const r = await fetch(`${MIRROR}/topics/${topicId}`);
    if (r.ok) t = await r.json();
    else await new Promise((res) => setTimeout(res, 2000));
  }
  const submitOk = t?.submit_key?.key?.toLowerCase() === key.publicKey.toStringRaw().toLowerCase();
  console.log(`dev topic ${topicId}  https://hashscan.io/testnet/topic/${topicId}`);
  console.log(`memo: ${t?.memo}`);
  console.log(`submit key: ${t?.submit_key?._type} ${submitOk ? "== oracle public key" : "MISMATCH"}; admin key: ${t?.admin_key ?? "none"}`);
  console.log(submitOk && !t?.admin_key ? "T1.4 PASS" : "T1.4 FAIL");
  process.exitCode = submitOk && !t?.admin_key ? 0 : 1;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
