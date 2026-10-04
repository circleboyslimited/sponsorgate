import { Link, useTitle } from "../lib/router";

const SECTIONS = [
  ["start", "Getting started"],
  ["concepts", "Concepts"],
  ["reference", "Library & API"],
  ["faq", "FAQ"],
] as const;

export function Docs() {
  useTitle("Docs · sponsorgate");
  return (
    <div className="mx-auto grid max-w-6xl gap-12 px-5 py-14 lg:grid-cols-[210px_1fr]">
      <aside className="hidden lg:block">
        <nav className="sticky top-24 space-y-1 text-sm">
          <p className="mb-3 px-3 lab text-indigo">On this page</p>
          {SECTIONS.map(([id, label]) => (
            <a
              key={id}
              href="#/docs"
              onClick={(e) => {
                e.preventDefault();
                document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
              }}
              className="block rounded-lg px-3 py-2 text-gray hover:bg-indigo-soft hover:text-indigo"
            >
              {label}
            </a>
          ))}
        </nav>
      </aside>

      <article className="min-w-0 space-y-16">
        <header>
          <p className="lab text-indigo">Documentation</p>
          <h1 className="mt-3 text-4xl md:text-5xl font-extrabold tracking-tight text-carbon">Running sponsorgate</h1>
          <p className="mt-4 max-w-2xl text-lg text-gray">A Node relayer and browser console for policy-checked fee-bump sponsorship on Stellar.</p>
        </header>

        <section id="start" className="scroll-mt-24 space-y-5">
          <h2 className="text-3xl font-extrabold tracking-tight text-carbon">Getting started</h2>
          <ol className="space-y-3">
            {START.map((step, i) => (
              <li key={i} className="flex gap-4">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold bg-indigo text-white">{i + 1}</span>
                <p className="pt-0.5 text-carbon/90">{step}</p>
              </li>
            ))}
          </ol>
          <Link to="/app" className="act act-ind inline-block inline-block">Design a policy →</Link>
        </section>

        <section id="concepts" className="scroll-mt-24 space-y-5">
          <h2 className="text-3xl font-extrabold tracking-tight text-carbon">Concepts</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {CONCEPTS.map(([term, body]) => (
              <div key={term} className="panel p-5">
                <h3 className="text-lg font-extrabold tracking-tight text-carbon">{term}</h3>
                <p className="mt-1.5 text-sm text-gray">{body}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="reference" className="scroll-mt-24 space-y-5">
          <h2 className="text-3xl font-extrabold tracking-tight text-carbon">Library & API</h2>
          <p className="text-gray">Run the relayer with a config file. The secret key comes only from the environment:</p>
          <pre className="overflow-x-auto p-5 font-mono text-xs leading-relaxed panel bg-carbon text-indigo-soft">{`npm install && npm run build
cp sponsorgate.config.example.json sponsorgate.config.json
SPONSOR_SECRET=S… node dist/bin.js sponsorgate.config.json`}</pre>
          <div className="panel overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="border-b border-border text-xs uppercase tracking-wider text-gray">
                <tr>
                  <th className="p-3.5">Export</th>
                  <th className="p-3.5">Kind</th>
                  <th className="p-3.5">What it does</th>
                </tr>
              </thead>
              <tbody>
                {REFERENCE.map(([fn, who, what]) => (
                  <tr key={fn} className="border-t border-border">
                    <td className="p-3.5 font-mono text-xs text-carbon">{fn}</td>
                    <td className="p-3.5 text-gray">{who}</td>
                    <td className="p-3.5 text-gray">{what}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section id="faq" className="scroll-mt-24 space-y-3">
          <h2 className="text-3xl font-extrabold tracking-tight text-carbon">FAQ</h2>
          {FAQ.map(([q, a]) => (
            <details key={q} className="panel group p-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold text-carbon">
                {q}
                <span className="transition group-open:rotate-45 text-indigo">+</span>
              </summary>
              <p className="mt-3 text-sm text-gray">{a}</p>
            </details>
          ))}
        </section>
      </article>
    </div>
  );
}

const START: string[] = [
  "Open the policy console.",
  "Pick the network and the operation types you’ll sponsor, and list the contracts users may call.",
  "Set limits: max operations, max fee per transaction, how soon transactions must expire, a per-account rate limit and a daily budget.",
  "Test transactions in the right-hand panel, then copy sponsorgate.config.json and run the relayer with SPONSOR_SECRET set."
];

const CONCEPTS: [string, string][] = [
  [
    "Fee bump",
    "A Stellar envelope that wraps a signed transaction and lets another account pay its fee."
  ],
  [
    "Inner transaction",
    "The user’s own signed transaction. sponsorgate never changes it; it only wraps it."
  ],
  [
    "Policy",
    "The rules a transaction must meet to be sponsored."
  ],
  [
    "Budget",
    "A daily cap on total fees paid by the sponsor. Requests beyond it are refused until the next day."
  ]
];

const REFERENCE: [string, string, string][] = [
  [
    "checkPolicy(tx, policy, sponsor, now)",
    "function",
    "Throws PolicyError with a reason if the transaction breaks the policy"
  ],
  [
    "parseInner(envelope, passphrase)",
    "function",
    "Decodes a user-signed transaction envelope"
  ],
  [
    "totalBumpFee(tx) · bumpBaseFee(tx)",
    "function",
    "Fee math for the fee bump"
  ],
  [
    "RateLimiter · DailyBudget",
    "class",
    "Per-account limits and the daily spend cap"
  ],
  [
    "Relayer",
    "class",
    "Checks, fee-bumps, signs and submits"
  ],
  [
    "createRelayerServer(relayer)",
    "function",
    "HTTP server around a Relayer"
  ]
];

const FAQ: [string, string][] = [
  [
    "Does the user still sign?",
    "Yes. Users sign their own transaction; the sponsor only signs the outer fee bump."
  ],
  [
    "What stops someone spamming my relayer?",
    "The per-account rate limit, the per-transaction fee cap and the daily budget."
  ],
  [
    "Why require transactions to expire soon?",
    "So a sponsored transaction can’t be held back and submitted much later."
  ],
  [
    "Where is the sponsor key stored?",
    "Only in the SPONSOR_SECRET environment variable, never in the config file."
  ],
  [
    "Can I use it as a library?",
    "Yes. Import Relayer and createRelayerServer, or use checkPolicy on its own."
  ],
  [
    "Does the console send data anywhere?",
    "No, unless you connect it to your own running relayer to see its status."
  ]
];
