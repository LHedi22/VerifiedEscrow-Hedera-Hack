/**
 * T0.1 one-off: create the client, freelancer and arbitrator accounts from the oracle.
 *
 *   pnpm --filter hedera-svc create-accounts           # create missing accounts, then verify all four
 *   pnpm --filter hedera-svc create-accounts --check   # verify only
 *
 * For each persona whose *_ACCOUNT_ID in .env is still a placeholder:
 *  1. generate an ECDSA key;
 *  2. auto-create the account by sending HBAR from the oracle to the key's EVM address;
 *  3. resolve the new account ID from the mirror node;
 *  4. finalize the hollow account (it pays 1 tinybar back to the oracle, signed with its own key),
 *     so it ends up a full ECDSA account with an EVM alias, as TRD §4 requires;
 *  5. write the ID and raw hex key into hedera-svc/.env (the only place keys live).
 * Keys are never printed.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  AccountId,
  Client,
  Hbar,
  HbarUnit,
  PrivateKey,
  TransactionId,
  TransferTransaction,
} from "@hashgraph/sdk";

const ENV_PATH = join(import.meta.dirname, "..", ".env");
const MIRROR = "https://testnet.mirrornode.hedera.com";
const HASHSCAN = "https://hashscan.io/testnet";
const TINYBARS_PER_HBAR = 100_000_000n;

// TRD §4: funding targets, and the minimums the mirror-node check enforces
const FUND_HBAR = { CLIENT: 80, FREELANCER: 5, ARBITRATOR: 15 } as const;
const MIN_HBAR = { ORACLE: 40, CLIENT: 40, FREELANCER: 2, ARBITRATOR: 5 } as const;
const ORACLE_FLOOR_HBAR = 100; // never leave the oracle below this
const NEW_PERSONAS = ["CLIENT", "FREELANCER", "ARBITRATOR"] as const;
const FEE_MARGIN_HBAR = 2; // transfer + finalization fees, generously

type Persona = keyof typeof MIN_HBAR;

function readEnv(): Map<string, string> {
  const env = new Map<string, string>();
  for (const line of readFileSync(ENV_PATH, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env.set(m[1], m[2].replace(/\s+#.*$/, "").trim());
  }
  return env;
}

function setEnvVars(values: Record<string, string>): void {
  let text = readFileSync(ENV_PATH, "utf8");
  for (const [k, v] of Object.entries(values)) {
    const re = new RegExp(`^${k}=.*$`, "m");
    if (!re.test(text)) throw new Error(`${k} not found in .env`);
    text = text.replace(re, `${k}=${v}`);
  }
  writeFileSync(ENV_PATH, text, "utf8");
}

const isSet = (id: string | undefined) => !!id && /^0\.0\.\d+$/.test(id);

async function mirror(path: string): Promise<any | null> {
  const r = await fetch(`${MIRROR}/api/v1${path}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`mirror ${path}: HTTP ${r.status}`);
  return r.json();
}

async function waitForAccount(idOrEvm: string, timeoutMs = 60_000): Promise<any> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const a = await mirror(`/accounts/${idOrEvm}`);
    if (a) return a;
    await new Promise((res) => setTimeout(res, 2000));
  }
  throw new Error(`account ${idOrEvm} not on the mirror node after ${timeoutMs / 1000} s`);
}

const hbar = (tinybars: bigint | number) => Number(BigInt(tinybars)) / Number(TINYBARS_PER_HBAR);

async function verify(env: Map<string, string>): Promise<boolean> {
  console.log("\nMirror-node check (TRD §4):");
  let ok = true;
  for (const p of Object.keys(MIN_HBAR) as Persona[]) {
    const id = env.get(`${p}_ACCOUNT_ID`);
    if (!isSet(id)) {
      console.log(`  ${p.padEnd(10)} not set`);
      ok = false;
      continue;
    }
    const a = await mirror(`/accounts/${id}`);
    const bal = a ? hbar(a.balance.balance) : 0;
    const keyType = a?.key?._type ?? "none (hollow)";
    const good = !!a && bal >= MIN_HBAR[p] && keyType === "ECDSA_SECP256K1" && /^0x[0-9a-f]{40}$/.test(a.evm_address);
    ok &&= good;
    console.log(
      `  ${good ? "OK  " : "FAIL"} ${p.padEnd(10)} ${id!.padEnd(12)} ${bal.toFixed(2).padStart(8)} ℏ (min ${MIN_HBAR[p]})  ` +
        `${keyType}  ${a?.evm_address ?? "-"}  ${HASHSCAN}/account/${id}`,
    );
  }
  return ok;
}

async function main() {
  const env = readEnv();
  const checkOnly = process.argv.includes("--check");
  const oracleId = env.get("ORACLE_ACCOUNT_ID");
  const oracleKeyHex = env.get("ORACLE_KEY");
  if (!isSet(oracleId) || !oracleKeyHex || !/^0x[0-9a-fA-F]{64}$/.test(oracleKeyHex)) {
    console.error("ORACLE_ACCOUNT_ID / ORACLE_KEY (raw 0x + 64 hex) must be set in hedera-svc/.env first.");
    process.exit(2);
  }

  if (!checkOnly) {
    const todo = NEW_PERSONAS.filter((p) => !isSet(env.get(`${p}_ACCOUNT_ID`)));
    const oracle = await mirror(`/accounts/${oracleId}`);
    if (!oracle) throw new Error(`oracle ${oracleId} not found on the mirror node`);
    const oracleHbar = hbar(oracle.balance.balance);
    const needHbar = todo.reduce((s, p) => s + FUND_HBAR[p], 0) + ORACLE_FLOOR_HBAR + (todo.length ? FEE_MARGIN_HBAR : 0);
    console.log(`Oracle ${oracleId}: ${oracleHbar.toFixed(2)} ℏ. To create: ${todo.join(", ") || "none"}. Needs ≥ ${needHbar} ℏ.`);
    if (oracleHbar < needHbar) {
      console.error(`STOP: oracle has ${oracleHbar.toFixed(2)} ℏ, needs ≥ ${needHbar} ℏ. Top it up from the faucet/Portal.`);
      process.exit(3);
    }

    const oracleKey = PrivateKey.fromStringECDSA(oracleKeyHex);
    const client = Client.forTestnet().setOperator(AccountId.fromString(oracleId!), oracleKey);

    for (const p of todo) {
      const key = PrivateKey.generateECDSA();
      const evm = `0x${key.publicKey.toEvmAddress()}`;
      const amount = Hbar.from(FUND_HBAR[p], HbarUnit.Hbar);

      // 1-2. auto account creation: transfer to the EVM address alias
      const create = await new TransferTransaction()
        .addHbarTransfer(oracleId!, amount.negated())
        .addHbarTransfer(AccountId.fromEvmAddress(0, 0, evm), amount)
        .execute(client);
      await create.getReceipt(client);

      // 3. new account ID from the mirror node
      const acct = await waitForAccount(evm);
      const newId = AccountId.fromString(acct.account);

      // 4. finalize the hollow account: it pays and signs a 1-tinybar transfer back to the oracle
      const finalize = await new TransferTransaction()
        .addHbarTransfer(newId, Hbar.fromTinybars(-1))
        .addHbarTransfer(oracleId!, Hbar.fromTinybars(1))
        .setTransactionId(TransactionId.generate(newId))
        .freezeWith(client)
        .sign(key);
      await (await finalize.execute(client)).getReceipt(client);

      // 5. persist; the key goes only into .env
      setEnvVars({ [`${p}_ACCOUNT_ID`]: newId.toString(), [`${p}_KEY`]: `0x${key.toStringRaw()}` });
      console.log(`Created ${p} ${newId} (${evm}), funded ${FUND_HBAR[p]} ℏ: ${HASHSCAN}/account/${newId}`);
    }
    client.close();
    if (todo.length) await new Promise((res) => setTimeout(res, 6000)); // let the mirror catch up
  }

  const ok = await verify(readEnv());
  console.log(ok ? "\nT0.1 PASS" : "\nT0.1 FAIL");
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e); // never dump objects that could hold keys
  process.exit(1);
});
