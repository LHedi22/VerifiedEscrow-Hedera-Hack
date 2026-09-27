import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SVC_DIR = resolve(import.meta.dirname, "..");

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set in hedera-svc/.env`);
  return v;
}

export const config = {
  port: 7000,
  host: "127.0.0.1", // localhost only (TRD §4)
  network: process.env.HEDERA_NETWORK ?? "testnet",
  relayUrl: process.env.RELAY_URL ?? "https://testnet.hashio.io/api",
  mirrorUrl: "https://testnet.mirrornode.hedera.com",
  internalToken: required("INTERNAL_TOKEN"),
  deploymentFile: resolve(SVC_DIR, process.env.DEPLOYMENT_FILE ?? "../shared/deployment.json"),
};

export type Deployment = {
  topicId?: string; // demo topic, created by contracts/scripts/deploy.ts (T2.3)
  devTopicId?: string; // Day 1-2 dev topic, created by contracts/scripts/create-dev-topic.ts (T1.4)
  contractAddress?: string;
  abi?: unknown[];
  deployedAt?: string;
};

/** Read on every call so a redeploy is picked up without restarting. */
export function deployment(): Deployment {
  return JSON.parse(readFileSync(config.deploymentFile, "utf8"));
}

/** The demo topic once it exists; until then (Day 1) the dev topic. Never both. */
export function hcsTopicId(): string {
  const d = deployment();
  const id = d.topicId ?? d.devTopicId;
  if (!id) throw new Error("no topicId or devTopicId in shared/deployment.json");
  return id;
}
