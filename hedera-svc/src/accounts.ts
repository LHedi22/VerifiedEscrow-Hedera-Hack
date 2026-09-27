import { AccountId, Client, PrivateKey } from "@hashgraph/sdk";
import { config } from "./config.js";

export const ROLES = ["oracle", "client", "freelancer", "arbitrator"] as const;
export type Role = (typeof ROLES)[number];

export type Persona = { role: Role; accountId: AccountId; key: PrivateKey; evmAddress: string };

const cache = new Map<Role, Persona>();

/** Keys: raw 32-byte hex from .env, always parsed as ECDSA (TRD §4). Never logged or returned. */
export function persona(role: Role): Persona {
  const hit = cache.get(role);
  if (hit) return hit;
  const env = role.toUpperCase();
  const id = process.env[`${env}_ACCOUNT_ID`] ?? "";
  const keyHex = process.env[`${env}_KEY`] ?? "";
  if (!/^0\.0\.\d+$/.test(id) || !/^0x[0-9a-fA-F]{64}$/.test(keyHex)) {
    throw new Error(`${env}_ACCOUNT_ID / ${env}_KEY not configured in hedera-svc/.env`);
  }
  const key = PrivateKey.fromStringECDSA(keyHex);
  const p: Persona = {
    role,
    accountId: AccountId.fromString(id),
    key,
    evmAddress: `0x${key.publicKey.toEvmAddress()}`.toLowerCase(),
  };
  cache.set(role, p);
  return p;
}

let oracleClient: Client | undefined;
/** SDK client with the oracle as operator: pays HCS fees and holds the topic submit key. */
export function oracleSdkClient(): Client {
  if (!oracleClient) {
    const o = persona("oracle");
    oracleClient = Client.forName(config.network).setOperator(o.accountId, o.key);
  }
  return oracleClient;
}

/** Balances and EVM aliases from the mirror node (AccountBalanceQuery is deprecated in v0.77). */
export async function accountsSummary() {
  const out: Record<string, { accountId: string; evmAddress: string; balanceHbar: string } | { error: string }> = {};
  for (const role of ROLES) {
    try {
      const p = persona(role);
      const r = await fetch(`${config.mirrorUrl}/api/v1/accounts/${p.accountId}`);
      if (!r.ok) throw new Error(`mirror HTTP ${r.status}`);
      const a = (await r.json()) as { evm_address: string; balance: { balance: number } };
      out[role] = {
        accountId: p.accountId.toString(),
        evmAddress: (a.evm_address ?? p.evmAddress).toLowerCase(),
        balanceHbar: (a.balance.balance / 1e8).toString(),
      };
    } catch (e) {
      out[role] = { error: e instanceof Error ? e.message : String(e) };
    }
  }
  return out;
}
