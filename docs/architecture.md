# Architecture

```text
POST /sponsor {xdr, submit?}
  └─ Relayer.sponsor
       ├─ parseInner        reject fee bumps / wrong network
       ├─ checkPolicy       signed · not sponsor · op types · contracts · op count · expiry
       ├─ fee cap           totalBumpFee ≤ maxFeeStroops
       ├─ DailyBudget       UTC day spend cap
       ├─ RateLimiter       sliding window per source account
       ├─ buildFeeBumpTransaction(sponsor) + sign
       └─ optional submit   Soroban RPC or Horizon
```

## Fee-bump rate

A fee bump must pay at least the inner transaction's fee *rate*. For Soroban
transactions the inner fee includes resource fees, so the per-op bump fee
is `max(100, ceil(inner_fee / ops) + 1)` and the total is that × (ops + 1).

## Threat model

| Attack | Defence |
| --- | --- |
| Make the sponsor pay for arbitrary activity | operation and contract allowlists |
| Get the sponsor's signature on its own account's ops | reject source == sponsor and op.source == sponsor |
| Drain via expensive Soroban calls | per-tx fee cap |
| Drain via volume | per-account rate limit + daily budget |
| Stockpile signed bumps for later | short `maxValiditySeconds` |
| Huge request bodies | 64 KiB body limit |
