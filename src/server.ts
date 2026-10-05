import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { PolicyError } from "./policy.js";
import type { Relayer } from "./relayer.js";

const MAX_BODY_BYTES = 64 * 1024;

export interface ServerOptions {
  /** Value for Access-Control-Allow-Origin; omit to disable CORS. */
  corsOrigin?: string;
  /** Serve Prometheus metrics at GET /metrics. */
  metrics?: boolean;
  log?: (line: string) => void;
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new PolicyError("request body too large", 413, "body_too_large");
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new PolicyError("body must be JSON", 400, "bad_json");
  }
}

function send(res: ServerResponse, status: number, body: unknown, cors?: string): void {
  res.writeHead(status, {
    "content-type": "application/json",
    ...(cors ? { "access-control-allow-origin": cors, "access-control-allow-headers": "content-type" } : {}),
  });
  res.end(JSON.stringify(body));
}

/** Prometheus text exposition of the relayer's counters and budget. */
export function metricsText(relayer: Relayer): string {
  const { stats } = relayer;
  const lines = [
    "# HELP sponsorgate_sponsored_total Transactions sponsored.",
    "# TYPE sponsorgate_sponsored_total counter",
    `sponsorgate_sponsored_total ${stats.sponsored}`,
    "# HELP sponsorgate_rejected_total Requests refused, by reason.",
    "# TYPE sponsorgate_rejected_total counter",
    ...Object.entries(stats.rejected).map(([code, n]) => `sponsorgate_rejected_total{code="${code}"} ${n}`),
    "# HELP sponsorgate_budget_remaining_stroops Daily budget left.",
    "# TYPE sponsorgate_budget_remaining_stroops gauge",
    `sponsorgate_budget_remaining_stroops ${relayer.status().budgetRemainingStroops}`,
  ];
  return lines.join("\n") + "\n";
}

export function createRelayerServer(relayer: Relayer, options: ServerOptions = {}): Server {
  const log = options.log ?? console.log;
  return createServer(async (req, res) => {
    const cors = options.corsOrigin;
    try {
      if (req.method === "OPTIONS") return send(res, 204, {}, cors);
      if (req.method === "GET" && req.url === "/health") return send(res, 200, { ok: true }, cors);
      if (req.method === "GET" && req.url === "/status") return send(res, 200, relayer.status(), cors);
      if (req.method === "GET" && req.url === "/metrics" && options.metrics) {
        res.writeHead(200, { "content-type": "text/plain; version=0.0.4" });
        return res.end(metricsText(relayer));
      }
      if (req.method === "POST" && req.url === "/sponsor") {
        const body = (await readJson(req)) as { xdr?: unknown; submit?: unknown };
        if (typeof body?.xdr !== "string") throw new PolicyError('body must include "xdr" (base64 envelope)', 400, "missing_xdr");
        const result = await relayer.sponsor(body.xdr, body.submit === true);
        log(`[sponsorgate] sponsored ${result.hash} (${result.feeStroops} stroops${result.submitted ? ", submitted" : ""})`);
        return send(res, 200, result, cors);
      }
      return send(res, 404, { error: "not found" }, cors);
    } catch (err) {
      if (err instanceof PolicyError) return send(res, err.status, { error: err.message, code: err.code }, cors);
      log(`[sponsorgate] ${err instanceof Error ? err.message : String(err)}`);
      return send(res, 502, { error: "submission failed", code: "submit_failed" }, cors);
    }
  });
}
