import {
  Account,
  Asset,
  Contract,
  FeeBumpTransaction,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  type xdr,
} from "@stellar/stellar-sdk";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { PolicyError, type Policy } from "./policy.js";
import { Relayer } from "./relayer.js";
import { createRelayerServer } from "./server.js";

const NOW = 1_800_000_000;
const sponsor = Keypair.random();
const user = Keypair.random();
const ALLOWED = "CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE";
const OTHER = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

const policy = (overrides: Partial<Policy> = {}): Policy => ({
  networkPassphrase: Networks.TESTNET,
  allowedOperations: ["invokeHostFunction", "payment"],
  allowedContracts: [ALLOWED],
  maxOperations: 2,
  maxFeeStroops: 10_000,
  maxValiditySeconds: 300,
  rateLimit: { max: 3, windowSeconds: 60 },
  dailyBudgetStroops: 1_000_000,
  ...overrides,
});

function tx(
  ops: xdr.Operation[],
  { signer = user, maxTime = NOW + 120, fee = "100", seq = "1" }: { signer?: Keypair | null; maxTime?: number; fee?: string; seq?: string } = {},
) {
  const b = new TransactionBuilder(new Account(user.publicKey(), seq), {
    fee,
    networkPassphrase: Networks.TESTNET,
    timebounds: { minTime: 0, maxTime },
  });
  ops.forEach((o) => b.addOperation(o));
  const t = b.build();
  if (signer) t.sign(signer);
  return t.toXDR();
}

const call = (contract = ALLOWED) => new Contract(contract).call("mint", nativeToScVal(1)) as xdr.Operation;
const pay = (source?: string) =>
  Operation.payment({ source, destination: Keypair.random().publicKey(), asset: Asset.native(), amount: "1" });

const relayer = (p = policy(), submitter?: (t: FeeBumpTransaction) => Promise<string>) =>
  new Relayer(p, sponsor, submitter, () => NOW);

async function rejects(promise: Promise<unknown>, pattern: RegExp, status?: number) {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(PolicyError);
  expect((err as PolicyError).message).toMatch(pattern);
  if (status) expect((err as PolicyError).status).toBe(status);
}

describe("Relayer.sponsor", () => {
  it("wraps an allowed contract call in a fee bump signed by the sponsor", async () => {
    const result = await relayer().sponsor(tx([call()]));
    const bump = TransactionBuilder.fromXDR(result.xdr, Networks.TESTNET) as FeeBumpTransaction;
    expect(bump).toBeInstanceOf(FeeBumpTransaction);
    expect(bump.feeSource).toBe(sponsor.publicKey());
    expect(bump.innerTransaction.source).toBe(user.publicKey());
    expect(bump.signatures).toHaveLength(1);
    expect(Number(bump.fee)).toBe(result.feeStroops);
    expect(result.submitted).toBe(false);
  });

  it("pays at least the inner fee rate (Soroban resource fees included)", async () => {
    const result = await relayer().sponsor(tx([call()], { fee: "3000" }));
    expect(result.feeStroops).toBeGreaterThan(3000);
  });

  it("refuses unsigned transactions and fee bumps", async () => {
    await rejects(relayer().sponsor(tx([call()], { signer: null })), /signed by its source/);
    const inner = TransactionBuilder.fromXDR(tx([call()]), Networks.TESTNET);
    const bumped = TransactionBuilder.buildFeeBumpTransaction(user, "200", inner as never, Networks.TESTNET);
    await rejects(relayer().sponsor(bumped.toXDR()), /not a fee bump/);
  });

  it("refuses operation types and contracts outside the policy", async () => {
    await rejects(
      relayer().sponsor(tx([Operation.setOptions({ masterWeight: 0 })])),
      /setOptions\) is not sponsored/,
      403,
    );
    await rejects(relayer().sponsor(tx([call(OTHER)])), /contract this relayer doesn't sponsor/, 403);
  });

  it("refuses anything acting as the sponsor account", async () => {
    await rejects(relayer().sponsor(tx([pay(sponsor.publicKey())])), /act as the sponsor/, 403);
  });

  it("enforces expiry and operation count", async () => {
    await rejects(relayer().sponsor(tx([call()], { maxTime: 0 })), /expire within 300s/);
    await rejects(relayer().sponsor(tx([call()], { maxTime: NOW + 3600 })), /expire within/);
    await rejects(relayer().sponsor(tx([call()], { maxTime: NOW - 1 })), /already expired/);
    await rejects(relayer().sponsor(tx([call(), call(), call()])), /1–2 operations/);
  });

  it("enforces the per-transaction fee cap", async () => {
    await rejects(relayer().sponsor(tx([call()], { fee: "50000" })), /exceeds the per-transaction cap/);
  });

  it("rate-limits each source account", async () => {
    const r = relayer();
    for (let i = 0; i < 3; i++) await r.sponsor(tx([call()], { seq: String(i) }));
    await rejects(r.sponsor(tx([call()], { seq: "9" })), /too many/, 429);
  });

  it("stops at the daily budget", async () => {
    const r = relayer(policy({ dailyBudgetStroops: 250, rateLimit: { max: 100, windowSeconds: 60 } }));
    const first = await r.sponsor(tx([call()])); // 202 stroops: (101 per op) × (1 op + bump)
    await rejects(r.sponsor(tx([call()], { seq: "2" })), /daily budget/, 503);
    expect((await r.status()).budgetRemainingStroops).toBe(250 - first.feeStroops);
  });

  it("submits when asked and a submitter is configured", async () => {
    const submitter = vi.fn().mockResolvedValue("hash");
    const result = await relayer(policy(), submitter).sponsor(tx([call()]), true);
    expect(submitter).toHaveBeenCalledOnce();
    expect(result.submitted).toBe(true);
    await rejects(relayer().sponsor(tx([call()], { seq: "5" }), true), /submission is not enabled/, 501);
  });

  it("rejects garbage", async () => {
    await rejects(relayer().sponsor("nope"), /valid transaction envelope/);
  });
});

describe("HTTP server", () => {
  async function withServer(fn: (base: string) => Promise<void>) {
    const server = createRelayerServer(relayer(), { corsOrigin: "https://app.example", log: () => {} });
    await new Promise<void>((r) => server.listen(0, r));
    const { port } = server.address() as AddressInfo;
    try {
      await fn(`http://127.0.0.1:${port}`);
    } finally {
      server.close();
    }
  }

  it("serves /sponsor, /status and /health with CORS", async () => {
    await withServer(async (base) => {
      const ok = await fetch(`${base}/sponsor`, { method: "POST", body: JSON.stringify({ xdr: tx([call()]) }) });
      expect(ok.status).toBe(200);
      expect(ok.headers.get("access-control-allow-origin")).toBe("https://app.example");
      expect(((await ok.json()) as { feeStroops: number }).feeStroops).toBeGreaterThan(0);

      const status = (await (await fetch(`${base}/status`)).json()) as { sponsor: string };
      expect(status.sponsor).toBe(sponsor.publicKey());
      expect((await fetch(`${base}/health`)).status).toBe(200);
    });
  });

  it("maps policy violations to their status codes", async () => {
    await withServer(async (base) => {
      const denied = await fetch(`${base}/sponsor`, {
        method: "POST",
        body: JSON.stringify({ xdr: tx([call(OTHER)]) }),
      });
      expect(denied.status).toBe(403);
      expect(((await denied.json()) as { error: string }).error).toMatch(/doesn't sponsor/);

      const bad = await fetch(`${base}/sponsor`, { method: "POST", body: "{" });
      expect(bad.status).toBe(400);
      expect((await fetch(`${base}/nope`)).status).toBe(404);
    });
  });
});
