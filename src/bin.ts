#!/usr/bin/env node
import { loadConfig, sponsorFromEnv, submitterFor } from "./config.js";
import { Relayer } from "./relayer.js";
import { createRelayerServer } from "./server.js";

try {
  const config = loadConfig(process.argv[2] ?? "sponsorgate.config.json");
  const sponsor = sponsorFromEnv();
  const relayer = new Relayer(config.policy, sponsor, submitterFor(config));
  const server = createRelayerServer(relayer, { corsOrigin: config.corsOrigin });
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
