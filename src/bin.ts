#!/usr/bin/env node
import { loadConfig, sponsorFromEnv, submitterFor } from "./config.js";
import { FileStateStore, RedisLimits, type LimitsBackend, type StateStore } from "./limits.js";
import { Relayer } from "./relayer.js";
import { createRelayerServer } from "./server.js";

async function limitsFor(config: ReturnType<typeof loadConfig>): Promise<StateStore | LimitsBackend | undefined> {
  if (config.redisUrl) {
    const { Redis } = await import("ioredis").catch(() => {
      throw new Error("redisUrl is set but the optional dependency ioredis isn't installed (npm install ioredis)");
    });
    return new RedisLimits(new Redis(config.redisUrl), config.policy.rateLimit, config.policy.dailyBudgetStroops);
  }
  return config.stateFile ? new FileStateStore(config.stateFile) : undefined;
}

try {
  const config = loadConfig(process.argv[2] ?? "sponsorgate.config.json");
  const sponsor = sponsorFromEnv();
  const relayer = new Relayer(config.policy, sponsor, submitterFor(config), undefined, await limitsFor(config));
  const server = createRelayerServer(relayer, { corsOrigin: config.corsOrigin, metrics: config.metrics });
  server.listen(config.port, () => {
    console.log(`[sponsorgate] sponsoring as ${sponsor.publicKey()} on :${config.port}`);
  });
  const stop = () => server.close(() => process.exit(0));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
} catch (err) {
  console.error(`sponsorgate: ${err instanceof Error ? err.message : String(err)}`);
  console.error("usage: SPONSOR_SECRET=S… sponsorgate [path/to/sponsorgate.config.json]");
  process.exit(1);
}
