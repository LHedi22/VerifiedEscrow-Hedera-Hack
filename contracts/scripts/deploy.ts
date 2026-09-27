/**
 * T2.3 (TRD §6, §7.5): deploy VerifiedEscrow with oracle = ORACLE_EVM_ADDRESS, create the demo topic
 * (submit key = oracle, no admin key, memo names the contract), and write shared/deployment.json.
 *
 *   npx hardhat run scripts/deploy.ts --network hederaTestnet
 *
 * The file is rewritten from scratch with the TRD keys only, which drops the Day 1 devTopicId:
 * after a deploy, nothing can fall back to the dev topic. Rebuild `web` after every deploy.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { AccountId, Client, PrivateKey, TopicCreateTransaction } from "@hashgraph/sdk";
import { artifacts, ethers, network } from "hardhat";

const DEPLOYMENT = join(__dirname, "..", "..", "shared", "deployment.json");
const MIRROR = "https://testnet.mirrornode.hedera.com/api/v1";
const HASHSCAN = "https://hashscan.io/testnet";

async function main() {
  const [oracle] = await ethers.getSigners();
  const oracleEvm = (await oracle.getAddress()).toLowerCase(); // ORACLE_EVM_ADDRESS, derived from ORACLE_KEY

  const factory = await ethers.getContractFactory("VerifiedEscrow");
  const c = await factory.deploy(oracleEvm, { gasLimit: 2_000_000 });
  await c.waitForDeployment();
  const contractAddress = (await c.getAddress()).toLowerCase();
  if (((await c.oracle()) as string).toLowerCase() !== oracleEvm) throw new Error("oracle() mismatch after deploy");
  console.log(`VerifiedEscrow ${contractAddress} (oracle ${oracleEvm})  ${HASHSCAN}/contract/${contractAddress}`);

  // Demo topic: one per deployment (TRD §6).
  const key = PrivateKey.fromStringECDSA(process.env.ORACLE_KEY!);
  const client = Client.forTestnet().setOperator(AccountId.fromString(process.env.ORACLE_ACCOUNT_ID!), key);
  const memo = `vte-escrow records v1 · ${contractAddress}`;
  const receipt = await (
    await new TopicCreateTransaction().setSubmitKey(key.publicKey).setTopicMemo(memo).execute(client)
  ).getReceipt(client);
  client.close();
  const topicId = receipt.topicId!.toString();

  const { abi } = await artifacts.readArtifact("VerifiedEscrow");
  const deployment = { network: network.name, contractAddress, abi, topicId, deployedAt: new Date().toISOString() };
  writeFileSync(DEPLOYMENT, JSON.stringify(deployment, null, 2) + "\n", "utf8");

  // Done-when: contract and topic on the mirror node; memo names the contract; submit key = oracle.
  let t: any = null;
  let k: any = null;
  for (let i = 0; i < 30 && !(t && k); i++) {
    const [rt, rc] = await Promise.all([fetch(`${MIRROR}/topics/${topicId}`), fetch(`${MIRROR}/contracts/${contractAddress}`)]);
    if (rt.ok) t = await rt.json();
    if (rc.ok) k = await rc.json();
    if (!(t && k)) await new Promise((res) => setTimeout(res, 2000));
  }
  const submitOk = t?.submit_key?.key?.toLowerCase() === key.publicKey.toStringRaw().toLowerCase();
  console.log(`contract on mirror: ${k?.contract_id} (${k?.evm_address})`);
  console.log(`demo topic ${topicId}  ${HASHSCAN}/topic/${topicId}`);
  console.log(`memo: "${t?.memo}"  names contract: ${t?.memo?.includes(contractAddress)}`);
  console.log(`submit key == oracle: ${submitOk}; admin key: ${t?.admin_key ?? "none"}`);
  console.log(`wrote ${DEPLOYMENT}: ${Object.keys(deployment).join(", ")}`);
  const ok = !!k && submitOk && !t?.admin_key && t?.memo?.includes(contractAddress);
  console.log(ok ? "T2.3 PASS" : "T2.3 FAIL");
  process.exitCode = ok ? 0 : 1;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
