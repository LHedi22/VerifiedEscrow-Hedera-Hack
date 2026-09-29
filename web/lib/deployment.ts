// shared/deployment.json, bundled at build time (TRD §7.5, §11). The browser takes the topic ID and contract
// address from here, never from `api`. Rebuild `web` after every deploy.
import deployment from "../../shared/deployment.json";

export const TOPIC_ID: string = (deployment as { topicId: string }).topicId;
export const CONTRACT_ADDRESS: string = (deployment as { contractAddress: string }).contractAddress.toLowerCase();
export const ABI = (deployment as { abi: unknown[] }).abi;
export const MIRROR_URL = "https://testnet.mirrornode.hedera.com";
