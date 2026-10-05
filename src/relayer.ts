import { Keypair, TransactionBuilder, type FeeBumpTransaction } from "@stellar/stellar-sdk";
import { DailyBudget, RateLimiter, type StateStore } from "./limits.js";
import { bumpBaseFee, checkPolicy, parseInner, PolicyError, totalBumpFee, type Policy } from "./policy.js";

/**
 * Submits a signed fee-bump envelope. Returns the hash, or the hash plus the
 * fee the network actually charged (so unused budget can be returned).
 */
export type Submitter = (feeBump: FeeBumpTransaction) => Promise<string | { hash: string; feeCharged?: number }>;

export interface RelayerStats {
  sponsored: number;
  rejected: Record<string, number>;
}

export interface SponsorResult {
  /** Fee-bump envelope, ready to submit (or already submitted). */
  xdr: string;
  hash: string;
  /** Max fee reserved from the budget. */
  feeStroops: number;
  /** Fee the network actually charged, when submitted and known. */
  feeChargedStroops?: number;
  submitted: boolean;
}

export class Relayer {
  private readonly limiter: RateLimiter;
  private readonly budget: DailyBudget;
  readonly stats: RelayerStats = { sponsored: 0, rejected: {} };

  constructor(
    private readonly policy: Policy,
    private readonly sponsorKey: Keypair,
    private readonly submitter?: Submitter,
    private readonly clock: () => number = () => Math.floor(Date.now() / 1000),
    private readonly store?: StateStore,
  ) {
    this.limiter = new RateLimiter(policy.rateLimit.max, policy.rateLimit.windowSeconds);
    this.budget = new DailyBudget(policy.dailyBudgetStroops);
    const saved = store?.load();
    if (saved) {
      this.limiter.load(saved.rateLimit);
      this.budget.load(saved.budget);
    }
  }

  private persist(): void {
    this.store?.save({ rateLimit: this.limiter.toJSON(), budget: this.budget.toJSON() });
  }

  async sponsor(envelope: string, submit = false): Promise<SponsorResult> {
    try {
      const result = await this.sponsorInner(envelope, submit);
      this.stats.sponsored++;
      return result;
    } catch (err) {
      const code = err instanceof PolicyError ? err.code : "submit_failed";
      this.stats.rejected[code] = (this.stats.rejected[code] ?? 0) + 1;
      throw err;
    } finally {
      this.persist();
    }
  }

  private async sponsorInner(envelope: string, submit: boolean): Promise<SponsorResult> {
    const now = this.clock();
    const inner = parseInner(envelope, this.policy.networkPassphrase);
    checkPolicy(inner, this.policy, this.sponsorKey.publicKey(), now);

    const fee = totalBumpFee(inner);
    if (fee > this.policy.maxFeeStroops) {
      throw new PolicyError(`fee ${fee} stroops exceeds the per-transaction cap of ${this.policy.maxFeeStroops}`, 400, "fee_too_high");
    }
    if (!this.budget.canSpend(fee, now)) {
      throw new PolicyError("the sponsor's daily budget is exhausted, try again tomorrow", 503, "budget_exhausted");
    }
    if (!this.limiter.take(inner.source, now)) {
      throw new PolicyError("too many sponsored transactions from this account, slow down", 429, "rate_limited");
    }

    const feeBump = TransactionBuilder.buildFeeBumpTransaction(
      this.sponsorKey,
      String(bumpBaseFee(inner)),
      inner,
      this.policy.networkPassphrase,
    );
    feeBump.sign(this.sponsorKey);
    this.budget.spend(fee, now);

    const hash = feeBump.hash().toString("hex");
    let feeCharged: number | undefined;
    if (submit) {
      if (!this.submitter) throw new PolicyError("submission is not enabled on this relayer", 501, "submit_disabled");
      const sent = await this.submitter(feeBump);
      feeCharged = typeof sent === "string" ? undefined : sent.feeCharged;
      // The budget reserved the max fee; give back what the network didn't charge.
      if (feeCharged !== undefined && feeCharged < fee) this.budget.refund(fee - feeCharged, now);
    }

    return { xdr: feeBump.toXDR(), hash, feeStroops: fee, feeChargedStroops: feeCharged, submitted: submit };
  }

  status() {
    const now = this.clock();
    return {
      sponsor: this.sponsorKey.publicKey(),
      network: this.policy.networkPassphrase,
      budgetRemainingStroops: this.budget.remaining(now),
      policy: this.policy,
    };
  }
}
