import { readFileSync } from "node:fs";
import { Horizon, Keypair, rpc, type FeeBumpTransaction } from "@stellar/stellar-sdk";
import type { Policy } from "./policy.js";
import type { Submitter } from "./relayer.js";

export interface RelayerConfig {
  port: number;
  corsOrigin?: string;
  /** Soroban RPC URL used for submission (preferred). */
  rpcUrl?: string;
  /** Horizon URL used for submission when no RPC URL is set. */
  horizonUrl?: string;
  policy: Policy;
}

export function loadConfig(path: string): RelayerConfig {
  const config = JSON.parse(readFileSync(path, "utf8")) as RelayerConfig;
  const p = config.policy;
  if (!p?.networkPassphrase) throw new Error("policy.networkPassphrase is required");
  if (!Array.isArray(p.allowedOperations) || p.allowedOperations.length === 0) {
    throw new Error("policy.allowedOperations must list at least one operation type");
  }
  for (const key of ["maxOperations", "maxFeeStroops", "maxValiditySeconds", "dailyBudgetStroops"] as const) {
    if (!Number.isInteger(p[key]) || p[key] <= 0) throw new Error(`policy.${key} must be a positive integer`);
  }
  if (!p.rateLimit || p.rateLimit.max <= 0 || p.rateLimit.windowSeconds <= 0) {
    throw new Error("policy.rateLimit needs positive max and windowSeconds");
  }
  return { ...config, port: config.port ?? 8787 };
}

/** The sponsor key comes from the environment, never from the config file. */
export function sponsorFromEnv(env: NodeJS.ProcessEnv = process.env): Keypair {
  const secret = env.SPONSOR_SECRET;
  if (!secret) throw new Error("SPONSOR_SECRET is not set");
  return Keypair.fromSecret(secret);
}

export function submitterFor(config: RelayerConfig): Submitter | undefined {
  if (config.rpcUrl) {
    const server = new rpc.Server(config.rpcUrl);
    return async (tx: FeeBumpTransaction) => {
      const res = await server.sendTransaction(tx);
      if (res.status === "ERROR") throw new Error(`RPC rejected the transaction: ${res.errorResult?.toXDR("base64")}`);
      return res.hash;
    };
  }
  if (config.horizonUrl) {
    const server = new Horizon.Server(config.horizonUrl);
    return async (tx: FeeBumpTransaction) => (await server.submitTransaction(tx)).hash;
  }
  return undefined;
}
