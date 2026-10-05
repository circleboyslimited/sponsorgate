import { readFileSync } from "node:fs";
import { Horizon, Keypair, rpc, type FeeBumpTransaction } from "@stellar/stellar-sdk";
import { validatePolicy, type Policy } from "./policy.js";
import type { Submitter } from "./relayer.js";

export interface RelayerConfig {
  port: number;
  corsOrigin?: string;
  /** Soroban RPC URL used for submission (preferred). */
  rpcUrl?: string;
  /** Horizon URL used for submission when no RPC URL is set. */
  horizonUrl?: string;
  /** Persist rate limits and the daily budget here so restarts don't reset them. */
  stateFile?: string;
  /**
   * Share rate limits and the daily budget through Redis (for several relayer
   * instances). Needs the optional `ioredis` dependency. Takes precedence over stateFile.
   */
  redisUrl?: string;
  /** Serve Prometheus metrics at GET /metrics. */
  metrics?: boolean;
  policy: Policy;
}

export function loadConfig(path: string): RelayerConfig {
  const config = JSON.parse(readFileSync(path, "utf8")) as RelayerConfig;
  validatePolicy(config.policy);
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
      // Wait briefly for the result so the budget can be charged what the network actually took.
      for (let i = 0; i < 15; i++) {
        await new Promise((r) => setTimeout(r, 1_000));
        const got = await server.getTransaction(res.hash).catch(() => null);
        if (got && got.status !== rpc.Api.GetTransactionStatus.NOT_FOUND) {
          const charged = "resultXdr" in got && got.resultXdr ? Number(got.resultXdr.feeCharged().toBigInt()) : undefined;
          return { hash: res.hash, feeCharged: charged };
        }
      }
      return res.hash;
    };
  }
  if (config.horizonUrl) {
    const server = new Horizon.Server(config.horizonUrl);
    return async (tx: FeeBumpTransaction) => {
      const res = (await server.submitTransaction(tx)) as { hash: string; fee_charged?: string | number };
      return { hash: res.hash, feeCharged: res.fee_charged === undefined ? undefined : Number(res.fee_charged) };
    };
  }
  return undefined;
}
