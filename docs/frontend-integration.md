# Frontend integration

```ts
// 1. Build and sign the user's transaction with their wallet as usual.
const signed = await wallet.signTransaction(tx.toXDR(), { networkPassphrase });

// 2. Ask sponsorgate to wrap (and submit) it.
const res = await fetch("https://relay.example.com/sponsor", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ xdr: signed, submit: true }),
});
if (!res.ok) throw new Error((await res.json()).error);
const { hash } = await res.json();
```

Users' accounts still need to exist (1 XLM minimum balance). Combine
sponsorgate with sponsored reserves if you also want to cover account
creation.
