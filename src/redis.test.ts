import { Account, Contract, Keypair, Networks, TransactionBuilder, nativeToScVal, type xdr } from "@stellar/stellar-sdk";
import { Redis } from "ioredis";
import { afterAll, describe, expect, it } from "vitest";
import { RedisLimits } from "./limits.js";
import { PolicyError, type Policy } from "./policy.js";
import { Relayer } from "./relayer.js";

// Runs against a real Redis when REDIS_URL is set (CI starts one).
const url = process.env.REDIS_URL;
const NOW = 1_800_000_000;
const prefix = () => `sgtest:${Date.now()}:${Math.random().toString(36).slice(2)}`;

describe.skipIf(!url)("RedisLimits", () => {
  const clients: Redis[] = [];
  const connect = () => {
    const c = new Redis(url!);
    clients.push(c);
    return c;
  };
  afterAll(async () => {
    await Promise.all(clients.map((c) => c.quit()));
  });

  it("reserves atomically: concurrent requests never overspend", async () => {
    const limits = new RedisLimits(connect(), { max: 100, windowSeconds: 60 }, 1_000, prefix());
    const results = await Promise.all(Array.from({ length: 50 }, () => limits.reserve(100, NOW)));
    expect(results.filter(Boolean)).toHaveLength(10);
    expect(await limits.remaining(NOW)).toBe(0);
    await limits.refund(250, NOW);
    expect(await limits.remaining(NOW)).toBe(250);
    await limits.refund(10_000, NOW); // never below zero spent
    expect(await limits.remaining(NOW)).toBe(1_000);
  });

  it("enforces a sliding window per account", async () => {
    const limits = new RedisLimits(connect(), { max: 2, windowSeconds: 60 }, 1_000, prefix());
    expect(await limits.take("GA", NOW)).toBe(true);
    expect(await limits.take("GA", NOW)).toBe(true);
    expect(await limits.take("GA", NOW + 1)).toBe(false);
    expect(await limits.take("GB", NOW + 1)).toBe(true); // other accounts unaffected
    expect(await limits.take("GA", NOW + 61)).toBe(true); // window moved on
  });

  it("shares limits between relayer instances", async () => {
    const shared = prefix();
    const policy: Policy = {
      networkPassphrase: Networks.TESTNET,
      allowedOperations: ["invokeHostFunction"],
      maxOperations: 1,
      maxFeeStroops: 10_000,
      maxValiditySeconds: 300,
      rateLimit: { max: 2, windowSeconds: 3_600 },
      dailyBudgetStroops: 1_000_000,
    };
    const sponsor = Keypair.random();
    const user = Keypair.random();
    const tx = (seq: string) => {
      const t = new TransactionBuilder(new Account(user.publicKey(), seq), {
        fee: "100",
        networkPassphrase: Networks.TESTNET,
        timebounds: { minTime: 0, maxTime: NOW + 120 },
      })
        .addOperation(new Contract("CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE").call("mint", nativeToScVal(1)) as xdr.Operation)
        .build();
      t.sign(user);
      return t.toXDR();
    };
    const relayer = () => new Relayer(policy, sponsor, undefined, () => NOW, new RedisLimits(connect(), policy.rateLimit, policy.dailyBudgetStroops, shared));
    const [a, b] = [relayer(), relayer()];

    const first = await a.sponsor(tx("1"));
    await b.sponsor(tx("2"));
    const third = await a.sponsor(tx("3")).catch((e: unknown) => e);
    expect((third as PolicyError).code).toBe("rate_limited");
    // Both instances see the same budget, and the refused request gave its reservation back.
    expect((await b.status()).budgetRemainingStroops).toBe(1_000_000 - 2 * first.feeStroops);
  });
});
