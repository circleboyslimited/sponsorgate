import { Account, Contract, Keypair, Networks, TransactionBuilder, nativeToScVal, type xdr } from "@stellar/stellar-sdk";
import { mkdtempSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileStateStore } from "./limits.js";
import { PolicyError, type Policy } from "./policy.js";
import { Relayer } from "./relayer.js";
import { createRelayerServer, metricsText } from "./server.js";

const NOW = 1_800_000_000;
const sponsor = Keypair.random();
const user = Keypair.random();
const TOKEN = "CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE";

const policy = (overrides: Partial<Policy> = {}): Policy => ({
  networkPassphrase: Networks.TESTNET,
  allowedOperations: ["invokeHostFunction"],
  allowedContracts: [`${TOKEN}:transfer`],
  maxOperations: 1,
  maxFeeStroops: 10_000,
  maxValiditySeconds: 300,
  rateLimit: { max: 2, windowSeconds: 3600 },
  dailyBudgetStroops: 1_000_000,
  ...overrides,
});

function tx(fn: string, seq = "1") {
  const t = new TransactionBuilder(new Account(user.publicKey(), seq), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
    timebounds: { minTime: 0, maxTime: NOW + 120 },
  })
    .addOperation(new Contract(TOKEN).call(fn, nativeToScVal(1)) as xdr.Operation)
    .build();
  t.sign(user);
  return t.toXDR();
}

describe("per-function allowlist", () => {
  it("allows only the listed function on the contract", async () => {
    const r = new Relayer(policy(), sponsor, undefined, () => NOW);
    await expect(r.sponsor(tx("transfer"))).resolves.toBeTruthy();
    const err = await r.sponsor(tx("approve", "2")).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PolicyError);
    expect((err as PolicyError).code).toBe("contract_not_allowed");
  });
});

describe("persistent limits", () => {
  it("keeps the rate limit and budget across restarts", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "sg-")), "state.json");
    const first = new Relayer(policy(), sponsor, undefined, () => NOW, new FileStateStore(file));
    await first.sponsor(tx("transfer", "1"));
    await first.sponsor(tx("transfer", "2"));
    const spent = 1_000_000 - first.status().budgetRemainingStroops;

    // "Restart": a new relayer reading the same file.
    const second = new Relayer(policy(), sponsor, undefined, () => NOW, new FileStateStore(file));
    expect(second.status().budgetRemainingStroops).toBe(1_000_000 - spent);
    const err = await second.sponsor(tx("transfer", "3")).catch((e: unknown) => e);
    expect((err as PolicyError).code).toBe("rate_limited");
  });
});

describe("actual fee charged", () => {
  it("returns unused budget when the network charged less", async () => {
    const r = new Relayer(policy(), sponsor, async () => ({ hash: "h", feeCharged: 150 }), () => NOW);
    const res = await r.sponsor(tx("transfer"), true);
    expect(res.feeChargedStroops).toBe(150);
    expect(r.status().budgetRemainingStroops).toBe(1_000_000 - 150);
  });

  it("still accepts submitters that only return a hash", async () => {
    const r = new Relayer(policy(), sponsor, async () => "h", () => NOW);
    const res = await r.sponsor(tx("transfer"), true);
    expect(r.status().budgetRemainingStroops).toBe(1_000_000 - res.feeStroops);
  });
});

describe("HTTP codes and metrics", () => {
  it("returns a code with every rejection and exposes Prometheus metrics", async () => {
    const r = new Relayer(policy(), sponsor, undefined, () => NOW);
    const server = createRelayerServer(r, { metrics: true, log: () => {} });
    await new Promise<void>((ok) => server.listen(0, ok));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const denied = await fetch(`${base}/sponsor`, { method: "POST", body: JSON.stringify({ xdr: tx("approve") }) });
      expect(await denied.json()).toMatchObject({ code: "contract_not_allowed" });
      const bad = await fetch(`${base}/sponsor`, { method: "POST", body: "{" });
      expect(await bad.json()).toMatchObject({ code: "bad_json" });
      await fetch(`${base}/sponsor`, { method: "POST", body: JSON.stringify({ xdr: tx("transfer", "9") }) });

      const metrics = await (await fetch(`${base}/metrics`)).text();
      expect(metrics).toContain("sponsorgate_sponsored_total 1");
      expect(metrics).toContain('sponsorgate_rejected_total{code="contract_not_allowed"} 1');
      expect(metrics).toMatch(/sponsorgate_budget_remaining_stroops \d+/);
      expect(metricsText(r)).toBe(metrics);
    } finally {
      server.close();
    }
  });
});
