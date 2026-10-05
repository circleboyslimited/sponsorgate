import { Keypair, TransactionBuilder, type FeeBumpTransaction } from "@stellar/stellar-sdk";
import { LocalLimits, type LimitsBackend, type StateStore } from "./limits.js";
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
  private readonly limits: LimitsBackend;
  readonly stats: RelayerStats = { sponsored: 0, rejected: {} };

  /**
   * `limits` is either a StateStore (single instance, persisted locally) or a
   * LimitsBackend such as RedisLimits (shared by several instances).
   */
  constructor(
    private readonly policy: Policy,
    private readonly sponsorKey: Keypair,
    private readonly submitter?: Submitter,
    private readonly clock: () => number = () => Math.floor(Date.now() / 1000),
    limits?: StateStore | LimitsBackend,
  ) {
    this.limits =
      limits && "reserve" in limits ? limits : new LocalLimits(policy.rateLimit, policy.dailyBudgetStroops, limits);
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
    // Reserve first (atomically, so parallel relayers can't overspend), then
    // rate-limit; anything that fails after the reservation gives it back.
    if (!(await this.limits.reserve(fee, now))) {
      throw new PolicyError("the sponsor's daily budget is exhausted, try again tomorrow", 503, "budget_exhausted");
    }
    let feeBump;
    try {
      if (!(await this.limits.take(inner.source, now))) {
        throw new PolicyError("too many sponsored transactions from this account, slow down", 429, "rate_limited");
      }
      feeBump = TransactionBuilder.buildFeeBumpTransaction(
        this.sponsorKey,
        String(bumpBaseFee(inner)),
        inner,
        this.policy.networkPassphrase,
      );
      feeBump.sign(this.sponsorKey);
    } catch (err) {
      await this.limits.refund(fee, now);
      throw err;
    }
    const hash = feeBump.hash().toString("hex");
    let feeCharged: number | undefined;
    if (submit) {
      if (!this.submitter) throw new PolicyError("submission is not enabled on this relayer", 501, "submit_disabled");
      const sent = await this.submitter(feeBump);
      feeCharged = typeof sent === "string" ? undefined : sent.feeCharged;
      // The budget reserved the max fee; give back what the network didn't charge.
      if (feeCharged !== undefined && feeCharged < fee) await this.limits.refund(fee - feeCharged, now);
    }

    return { xdr: feeBump.toXDR(), hash, feeStroops: fee, feeChargedStroops: feeCharged, submitted: submit };
  }

  async status() {
    const now = this.clock();
    return {
      sponsor: this.sponsorKey.publicKey(),
      network: this.policy.networkPassphrase,
      budgetRemainingStroops: await this.limits.remaining(now),
      policy: this.policy,
    };
  }
}
