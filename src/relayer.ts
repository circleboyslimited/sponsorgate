import { Keypair, TransactionBuilder, type FeeBumpTransaction } from "@stellar/stellar-sdk";
import { DailyBudget, RateLimiter } from "./limits.js";
import { bumpBaseFee, checkPolicy, parseInner, PolicyError, totalBumpFee, type Policy } from "./policy.js";

/** Submits a signed fee-bump envelope; returns the transaction hash. */
export type Submitter = (feeBump: FeeBumpTransaction) => Promise<string>;

export interface SponsorResult {
  /** Fee-bump envelope, ready to submit (or already submitted). */
  xdr: string;
  hash: string;
  feeStroops: number;
  submitted: boolean;
}

export class Relayer {
  private readonly limiter: RateLimiter;
  private readonly budget: DailyBudget;

  constructor(
    private readonly policy: Policy,
    private readonly sponsorKey: Keypair,
    private readonly submitter?: Submitter,
    private readonly clock: () => number = () => Math.floor(Date.now() / 1000),
  ) {
    this.limiter = new RateLimiter(policy.rateLimit.max, policy.rateLimit.windowSeconds);
    this.budget = new DailyBudget(policy.dailyBudgetStroops);
  }

  async sponsor(envelope: string, submit = false): Promise<SponsorResult> {
    const now = this.clock();
    const inner = parseInner(envelope, this.policy.networkPassphrase);
    checkPolicy(inner, this.policy, this.sponsorKey.publicKey(), now);

    const fee = totalBumpFee(inner);
    if (fee > this.policy.maxFeeStroops) {
      throw new PolicyError(`fee ${fee} stroops exceeds the per-transaction cap of ${this.policy.maxFeeStroops}`);
    }
    if (!this.budget.canSpend(fee, now)) {
      throw new PolicyError("the sponsor's daily budget is exhausted, try again tomorrow", 503);
    }
    if (!this.limiter.take(inner.source, now)) {
      throw new PolicyError("too many sponsored transactions from this account, slow down", 429);
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
    if (submit) {
      if (!this.submitter) throw new PolicyError("submission is not enabled on this relayer", 501);
      await this.submitter(feeBump);
    }
    return { xdr: feeBump.toXDR(), hash, feeStroops: fee, submitted: submit };
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
