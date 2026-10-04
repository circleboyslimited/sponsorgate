const DECISIONS: [boolean, string, string][] = [
  [true, "invokeHostFunction → your contract", "Allowed operation, allowlisted contract, fee under the cap: sponsored."],
  [false, "setOptions: add a signer", "Operation type isn’t in the policy, so the sponsor never signs it."],
  [false, "payment valid for 30 days", "Expiry window too long: rejected so it can’t be replayed much later."],
  [false, "one too many from one account", "Per-account rate limit or daily budget reached: refused until it resets."],
];
import { Link, useTitle } from "../lib/router";

export function Home() {
  useTitle("sponsorgate · policy-checked fee sponsorship for Stellar");
  const STATS: [string, string][] = [
    ["Rejections", "explained"],
    ["Secret in config", "never"],
    ["Spend", "capped"],
  ];
  return (
    <>
      <section className="mx-auto grid max-w-6xl items-center gap-12 px-5 pb-20 pt-14 md:grid-cols-[1.2fr_1fr] md:pt-20">
        <div>
          <p className="lab text-indigo">Fee-bump relayer for Stellar</p>
          <h1 className="mt-4 text-5xl leading-[1.03] md:text-6xl font-extrabold tracking-tight text-carbon">Sponsor your users’ fees. <span className="text-indigo">Only the ones you meant to.</span></h1>
          <p className="mt-6 max-w-xl text-lg text-gray">sponsorgate wraps your users’ transactions in fee bumps so they never need XLM for fees, and checks each one against your policy first: operations, contracts, fee caps, expiry, rate limits and a daily budget.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/app" className="act act-ind inline-block">Design a policy →</Link>
            <Link to="/docs" className="act act-out inline-block">How it works</Link>
          </div>
          <dl className="mt-12 grid max-w-lg grid-cols-3 gap-6">
            {STATS.map(([label, value]) => (
              <div key={label}>
                <dt className="text-[11px] uppercase tracking-wider text-gray">{label}</dt>
                <dd className="mt-1 text-2xl font-extrabold tracking-tight text-carbon">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="panel p-7">
          <p className="lab">Example decisions</p>
          <ul className="mt-4 space-y-3 text-sm">
            {DECISIONS.map(([ok, what, why]) => (
              <li key={what} className="flex gap-3 rounded-xl border border-border p-3">
                <span className={`mt-0.5 font-bold ${ok ? "text-pass" : "text-fail"}`}>{ok ? "✓" : "✕"}</span>
                <span>
                  <b className="font-mono text-xs">{what}</b>
                  <br />
                  <span className="text-gray">{why}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="border-y border-border bg-white">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <p className="lab text-indigo">How it works</p>
          <h2 className="mt-3 text-3xl md:text-4xl font-extrabold tracking-tight text-carbon">Policy first, then pay the fee</h2>
          <ol className="mt-10 grid gap-6 md:grid-cols-3">
            {STEPS.map(([title, body], i) => (
              <li key={title} className="panel p-6">
                <span className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold bg-indigo text-white">{i + 1}</span>
                <h3 className="mt-4 text-xl font-extrabold tracking-tight text-carbon">{title}</h3>
                <p className="mt-2 text-sm text-gray">{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-20">
        <p className="lab text-indigo">Use cases</p>
        <h2 className="mt-3 text-3xl md:text-4xl font-extrabold tracking-tight text-carbon">Gasless UX without an open wallet</h2>
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {USES.map(([icon, title, body]) => (
            <div key={title} className="panel p-6">
              <span className="text-3xl">{icon}</span>
              <h3 className="mt-3 text-lg font-extrabold tracking-tight text-carbon">{title}</h3>
              <p className="mt-2 text-sm text-gray">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5">
        <p className="lab text-indigo">Guarantees</p>
        <h2 className="mt-3 text-3xl md:text-4xl font-extrabold tracking-tight text-carbon">A sponsor that can’t be drained</h2>
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {PROMISES.map(([title, body]) => (
            <div key={title} className="rounded-2xl p-7 bg-carbon text-white">
              <h3 className="text-xl font-extrabold tracking-tight">{title}</h3>
              <p className="mt-2 text-sm text-white/70">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 pt-20">
        <div className="panel flex flex-col items-start justify-between gap-6 p-10 md:flex-row md:items-center">
          <div>
            <h2 className="text-3xl font-extrabold tracking-tight text-carbon">Design and test a policy in your browser.</h2>
            <p className="mt-2 text-gray">Paste real transactions and see exactly what would be sponsored, before you deploy anything.</p>
          </div>
          <Link to="/app" className="act act-ind inline-block shrink-0">Design a policy →</Link>
        </div>
      </section>
    </>
  );
}

const STEPS: [string, string][] = [
  [
    "The user signs",
    "Your app builds the transaction with the user as source and gets their signature as usual."
  ],
  [
    "sponsorgate checks",
    "Operation types, contract allowlist, operation count, fee cap, validity window, rate limit and budget."
  ],
  [
    "Fee bump and submit",
    "Only if every check passes does the sponsor sign a fee bump and submit it. Otherwise it returns the reason."
  ]
];

const USES: [string, string, string][] = [
  [
    "📱",
    "Consumer apps",
    "New users transact before they ever hold XLM."
  ],
  [
    "🎮",
    "Games",
    "Sponsor calls to your game contract and nothing else."
  ],
  [
    "🏪",
    "Marketplaces",
    "Cover checkout fees within a daily budget."
  ],
  [
    "🧪",
    "Demos & hackathons",
    "Let people try your dApp with a brand-new wallet."
  ]
];

const PROMISES: [string, string][] = [
  [
    "Allowlist, not blocklist",
    "Only the operation types and contracts you list are sponsored. Everything else is rejected."
  ],
  [
    "Hard limits",
    "A per-transaction fee cap, a per-account rate limit and a daily budget bound what you can ever spend."
  ],
  [
    "Key stays out of config",
    "The sponsor secret is read only from the SPONSOR_SECRET environment variable."
  ]
];
