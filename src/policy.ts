import { Address, FeeBumpTransaction, Transaction, TransactionBuilder, xdr } from "@stellar/stellar-sdk";

export interface Policy {
  networkPassphrase: string;
  /** Operation types the sponsor will pay for, e.g. ["invokeHostFunction", "payment"]. */
  allowedOperations: string[];
  /** If set, contract calls must target one of these contract ids (C…). */
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

export class PolicyError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "PolicyError";
  }
}

/** Parse a user's signed envelope; fee bumps are refused (we add our own). */
export function parseInner(envelope: string, networkPassphrase: string): Transaction {
  let parsed: Transaction | FeeBumpTransaction;
  try {
    parsed = TransactionBuilder.fromXDR(envelope, networkPassphrase);
  } catch {
    throw new PolicyError("xdr is not a valid transaction envelope for this network");
  }
  if (parsed instanceof FeeBumpTransaction) {
    throw new PolicyError("send the inner transaction, not a fee bump");
  }
  return parsed;
}

/**
 * Stateless checks: what the transaction is allowed to do. Throws a
 * PolicyError explaining the first violation.
 */
export function checkPolicy(tx: Transaction, policy: Policy, sponsor: string, now: number): void {
  if (tx.signatures.length === 0) {
    throw new PolicyError("the transaction must be signed by its source before sponsoring");
  }
  if (tx.source === sponsor) {
    throw new PolicyError("the sponsor account can't be the transaction source", 403);
  }
  if (tx.operations.length === 0 || tx.operations.length > policy.maxOperations) {
    throw new PolicyError(`transactions may contain 1–${policy.maxOperations} operations`);
  }

  const maxTime = Number(tx.timeBounds?.maxTime ?? 0);
  if (maxTime === 0 || maxTime - now > policy.maxValiditySeconds) {
    throw new PolicyError(`the transaction must expire within ${policy.maxValiditySeconds}s`);
  }
  if (maxTime < now) throw new PolicyError("the transaction has already expired");

  tx.operations.forEach((op, i) => {
    if (op.source === sponsor) {
      throw new PolicyError(`operation ${i + 1} tries to act as the sponsor account`, 403);
    }
    if (!policy.allowedOperations.includes(op.type)) {
      throw new PolicyError(`operation ${i + 1} (${op.type}) is not sponsored by this relayer`, 403);
    }
    if (op.type === "invokeHostFunction" && policy.allowedContracts) {
      const contract = contractOf(op.func);
      if (!contract || !policy.allowedContracts.includes(contract)) {
        throw new PolicyError(`operation ${i + 1} calls a contract this relayer doesn't sponsor`, 403);
      }
    }
  });
}

function contractOf(func: xdr.HostFunction): string | null {
  if (func.switch() !== xdr.HostFunctionType.hostFunctionTypeInvokeContract()) return null;
  return Address.fromScAddress(func.invokeContract().contractAddress()).toString();
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
