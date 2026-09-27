/**
 * T1.6 WhoAmI spike (TRD §7.4). Run: npx hardhat run scripts/whoami-spike.ts --network hederaTestnet
 * Checks: msg.sender == oracle EVM alias; 1 HBAR arrives as 100000000 (tinybars); fee per call.
 */
import { ethers } from "hardhat";

const MIRROR = "https://testnet.mirrornode.hedera.com/api/v1";
const HASHSCAN = "https://hashscan.io/testnet";

async function mirror(path: string, tries = 20): Promise<any> {
  for (let i = 0; i < tries; i++) {
    const r = await fetch(`${MIRROR}${path}`);
    if (r.ok) return r.json();
    await new Promise((res) => setTimeout(res, 2000));
  }
  throw new Error(`mirror ${path} not available`);
}

/** HBAR actually charged for an EVM transaction, from the mirror node. */
async function feeHbar(txHash: string): Promise<{ fee: number; timestamp: string; gasUsed: number }> {
  const result = await mirror(`/contracts/results/${txHash}`);
  const tx = await mirror(`/transactions?timestamp=${result.timestamp}`);
  return { fee: tx.transactions[0].charged_tx_fee / 1e8, timestamp: result.timestamp, gasUsed: result.gas_used };
}

async function main() {
  const [oracle] = await ethers.getSigners();
  const oracleEvm = (await oracle.getAddress()).toLowerCase();
  console.log(`oracle signer: ${oracleEvm}`);

  const factory = await ethers.getContractFactory("WhoAmI");
  const c = await factory.deploy({ gasLimit: 400_000 });
  await c.waitForDeployment();
  const address = (await c.getAddress()).toLowerCase();
  const deployHash = c.deploymentTransaction()!.hash;
  console.log(`deployed WhoAmI at ${address}  ${HASHSCAN}/contract/${address}`);

  const viewSender = ((await c.whoami()) as string).toLowerCase();

  const tx = await c.echoValue({ value: ethers.parseEther("1"), gasLimit: 400_000 });
  const receipt = await tx.wait();
  const ev = receipt!.logs.map((l) => c.interface.parseLog(l)).find((e) => e?.name === "Echo")!;
  const txSender = (ev.args.sender as string).toLowerCase();
  const value = ev.args.value as bigint;

  const deployFee = await feeHbar(deployHash);
  const callFee = await feeHbar(tx.hash);

  console.log(`whoami() (eth_call):        ${viewSender}  ${viewSender === oracleEvm ? "== oracle" : "!= ORACLE"}`);
  console.log(`echoValue() msg.sender:     ${txSender}  ${txSender === oracleEvm ? "== oracle" : "!= ORACLE"}`);
  console.log(`echoValue() msg.value:      ${value}  ${value === 100_000_000n ? "(tinybars, as expected)" : "(UNEXPECTED UNIT)"}`);
  console.log(`fee deploy:  ${deployFee.fee.toFixed(4)} ℏ (gas used ${deployFee.gasUsed})`);
  console.log(`fee call:    ${callFee.fee.toFixed(4)} ℏ (gas used ${callFee.gasUsed}, limit 400000)  ${HASHSCAN}/transaction/${callFee.timestamp}`);
  const ok = viewSender === oracleEvm && txSender === oracleEvm && value === 100_000_000n;
  console.log(ok ? "T1.6 PASS" : "T1.6 FAIL");
  if (callFee.fee > 0.5) console.log("NOTE: fee per call > 0.5 ℏ: recompute the TRD §4 budget");
  process.exitCode = ok ? 0 : 1;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
