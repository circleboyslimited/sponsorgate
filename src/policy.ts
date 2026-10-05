import { Address, FeeBumpTransaction, Transaction, TransactionBuilder, xdr } from "@stellar/stellar-sdk";

export interface Policy {
  networkPassphrase: string;
  /** Operation types the sponsor will pay for, e.g. ["invokeHostFunction", "payment"]. */
  allowedOperations: string[];
  /**
   * If set, contract calls must match an entry: a contract id ("C…") allows
   * any function on it, "C…:fn" allows only that function.
   */
  allowedContracts?: string[];
  /** Max operations per sponsored transaction. */
  maxOperations: number;
  /** Max total fee (stroops) the sponsor will pay for one transaction. */
  maxFeeStroops: number;
  /** Inner transactions must expire within this many seconds. */
  maxValiditySeconds: number;
  /** Sponsored transactions allowed per source account per window. */
  rateLimit: { max: number; windowSeconds: number };
  /** Total stroops the sponsor will spend per UTC day. */
  dailyBudgetStroops: number;
}

/** Stable, machine-readable reasons a request was refused (see README). */
export type RejectionCode =
  | "invalid_xdr"
  | "fee_bump_not_allowed"
  | "unsigned"
  | "sponsor_is_source"
  | "too_many_operations"
  | "validity_too_long"
  | "expired"
  | "acts_as_sponsor"
  | "operation_not_allowed"
  | "contract_not_allowed"
  | "fee_too_high"
  | "budget_exhausted"
  | "rate_limited"
  | "submit_disabled"
  | "body_too_large"
  | "bad_json"
  | "missing_xdr"
  | "policy_violation";

export class PolicyError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
    public readonly code: RejectionCode = "policy_violation",
  ) {
    super(message);
    this.name = "PolicyError";
  }
}

/** Check a policy's shape, throwing a readable error on the first problem. */
export function validatePolicy(raw: unknown): Policy {
  const p = raw as Partial<Policy> | undefined;
  if (!p || typeof p !== "object") throw new Error("policy must be an object");
  if (!p.networkPassphrase) throw new Error("policy.networkPassphrase is required");
  if (!Array.isArray(p.allowedOperations) || p.allowedOperations.length === 0) {
    throw new Error("policy.allowedOperations must list at least one operation type");
  }
  for (const key of ["maxOperations", "maxFeeStroops", "maxValiditySeconds", "dailyBudgetStroops"] as const) {
    if (!Number.isInteger(p[key]) || (p[key] as number) <= 0) throw new Error(`policy.${key} must be a positive integer`);
  }
  if (!p.rateLimit || !(p.rateLimit.max > 0) || !(p.rateLimit.windowSeconds > 0)) {
    throw new Error("policy.rateLimit needs positive max and windowSeconds");
  }
  if (p.allowedContracts !== undefined) {
    if (!Array.isArray(p.allowedContracts)) throw new Error("policy.allowedContracts must be a list");
    for (const entry of p.allowedContracts) {
      if (!/^C[A-Z2-7]{55}(:[A-Za-z0-9_]{1,32})?$/.test(entry)) {
        throw new Error(`policy.allowedContracts: "${entry}" should be a contract id, optionally followed by :function`);
      }
    }
  }
  return p as Policy;
}

/** Parse a user's signed envelope; fee bumps are refused (we add our own). */
export function parseInner(envelope: string, networkPassphrase: string): Transaction {
  let parsed: Transaction | FeeBumpTransaction;
  try {
    parsed = TransactionBuilder.fromXDR(envelope, networkPassphrase);
  } catch {
    throw new PolicyError("xdr is not a valid transaction envelope for this network", 400, "invalid_xdr");
  }
  if (parsed instanceof FeeBumpTransaction) {
    throw new PolicyError("send the inner transaction, not a fee bump", 400, "fee_bump_not_allowed");
  }
  return parsed;
}

/**
 * Stateless checks: what the transaction is allowed to do. Throws a
 * PolicyError explaining the first violation.
 */
export function checkPolicy(tx: Transaction, policy: Policy, sponsor: string, now: number): void {
  if (tx.signatures.length === 0) {
    throw new PolicyError("the transaction must be signed by its source before sponsoring", 400, "unsigned");
  }
  if (tx.source === sponsor) {
    throw new PolicyError("the sponsor account can't be the transaction source", 403, "sponsor_is_source");
  }
  if (tx.operations.length === 0 || tx.operations.length > policy.maxOperations) {
    throw new PolicyError(`transactions may contain 1–${policy.maxOperations} operations`, 400, "too_many_operations");
  }

  const maxTime = Number(tx.timeBounds?.maxTime ?? 0);
  if (maxTime === 0 || maxTime - now > policy.maxValiditySeconds) {
    throw new PolicyError(`the transaction must expire within ${policy.maxValiditySeconds}s`, 400, "validity_too_long");
  }
  if (maxTime < now) throw new PolicyError("the transaction has already expired", 400, "expired");

  tx.operations.forEach((op, i) => {
    if (op.source === sponsor) {
      throw new PolicyError(`operation ${i + 1} tries to act as the sponsor account`, 403, "acts_as_sponsor");
    }
    if (!policy.allowedOperations.includes(op.type)) {
      throw new PolicyError(`operation ${i + 1} (${op.type}) is not sponsored by this relayer`, 403, "operation_not_allowed");
    }
    if (op.type === "invokeHostFunction" && policy.allowedContracts) {
      const call = contractCall(op.func);
      const allowed =
        !!call && (policy.allowedContracts.includes(call.contract) || policy.allowedContracts.includes(`${call.contract}:${call.fn}`));
      if (!allowed) {
        throw new PolicyError(`operation ${i + 1} calls a contract this relayer doesn't sponsor`, 403, "contract_not_allowed");
      }
    }
  });
}

function contractCall(func: xdr.HostFunction): { contract: string; fn: string } | null {
  if (func.switch() !== xdr.HostFunctionType.hostFunctionTypeInvokeContract()) return null;
  const call = func.invokeContract();
  return { contract: Address.fromScAddress(call.contractAddress()).toString(), fn: call.functionName().toString() };
}

/**
 * Per-operation fee for the fee bump. A fee bump must pay at least the
 * inner transaction's fee rate (which for Soroban includes resource fees)
 * across ops + 1, so derive it from the inner fee.
 */
export function bumpBaseFee(tx: Transaction, minBaseFee = 100): number {
  const ops = tx.operations.length;
  return Math.max(minBaseFee, Math.ceil(Number(tx.fee) / ops) + 1);
}

export function totalBumpFee(tx: Transaction, minBaseFee = 100): number {
  return bumpBaseFee(tx, minBaseFee) * (tx.operations.length + 1);
}
