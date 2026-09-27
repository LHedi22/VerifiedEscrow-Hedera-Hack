import "@nomicfoundation/hardhat-toolbox";
import type { HardhatUserConfig } from "hardhat/config";
import * as dotenv from "dotenv";

// Keys live only in hedera-svc/.env (CLAUDE.md invariant)
dotenv.config({ path: "../hedera-svc/.env" });

const oracleKey = process.env.ORACLE_KEY ?? "";
const accounts = /^0x[0-9a-fA-F]{64}$/.test(oracleKey) ? [oracleKey] : []; // placeholder until T0.1

const config: HardhatUserConfig = {
  // TRD §3: solc 0.8.24 pinned exactly, evmVersion shanghai
  solidity: {
    version: "0.8.24",
    settings: { evmVersion: "shanghai", optimizer: { enabled: true, runs: 200 } },
  },
  networks: {
    hederaTestnet: {
      url: process.env.RELAY_URL ?? "https://testnet.hashio.io/api",
      chainId: 296,
      accounts,
    },
  },
};

export default config;
