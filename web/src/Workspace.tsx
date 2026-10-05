import { useMemo, useState } from "react";
import { Account, Asset, Contract, Keypair, Networks, Operation, TransactionBuilder, nativeToScVal, type xdr } from "@stellar/stellar-sdk";
import { checkPolicy, parseInner, PolicyError, totalBumpFee, validatePolicy, type Policy } from "../../src/policy";

const OP_TYPES = ["invokeHostFunction", "payment", "pathPaymentStrictSend", "changeTrust", "manageData", "setOptions", "createAccount"];
const STROOPS = 10_000_000;
const SPONSOR_DEMO = Keypair.random().publicKey();

function makeSample(kind: "call" | "payment" | "setOptions" | "slow", contract: string): string {
  const user = Keypair.random();
  const now = Math.floor(Date.now() / 1000);
  const op: xdr.Operation =
    kind === "payment"
      ? Operation.payment({ destination: Keypair.random().publicKey(), asset: Asset.native(), amount: "5" })
      : kind === "setOptions"
        ? Operation.setOptions({ masterWeight: 0 })
        : (new Contract(contract).call("mint", nativeToScVal(user.publicKey(), { type: "address" })) as unknown as xdr.Operation);
  const tx = new TransactionBuilder(new Account(user.publicKey(), "41"), {
    fee: kind === "call" ? "45000" : "100",
    networkPassphrase: Networks.TESTNET,
    timebounds: { minTime: 0, maxTime: now + (kind === "slow" ? 86_400 : 120) },
  })
    .addOperation(op)
    .build();
  tx.sign(user);
  return tx.toXDR();
}

export function Workspace() {
  const [policy, setPolicy] = useState<Policy>({
    networkPassphrase: Networks.TESTNET,
    allowedOperations: ["invokeHostFunction"],
    allowedContracts: ["CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"],
    maxOperations: 1,
    maxFeeStroops: 2_000_000,
    maxValiditySeconds: 300,
    rateLimit: { max: 10, windowSeconds: 3600 },
    dailyBudgetStroops: 500_000_000,
  });
  const [contractsText, setContractsText] = useState(policy.allowedContracts!.join("\n"));
  const [xdrIn, setXdrIn] = useState("");
  const [importText, setImportText] = useState("");
  const [importMsg, setImportMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Load an existing sponsorgate.config.json (or a bare policy) back into the form.
  const importConfig = (text: string) => {
    try {
      const parsed = JSON.parse(text) as { policy?: unknown };
      const p = validatePolicy(parsed && typeof parsed === "object" && "policy" in parsed ? parsed.policy : parsed);
      setPolicy({ ...p, allowedContracts: p.allowedContracts ?? [] });
      setContractsText((p.allowedContracts ?? []).join("\n"));
      setImportMsg({ ok: true, text: "Config loaded into the form." });
    } catch (e) {
      setImportMsg({ ok: false, text: e instanceof SyntaxError ? "That isn't valid JSON." : e instanceof Error ? e.message : String(e) });
    }
  };
  const set = <K extends keyof Policy>(k: K, v: Policy[K]) => setPolicy((p) => ({ ...p, [k]: v }));

  const effective: Policy = useMemo(() => {
    const list = contractsText.split(/\s+/).filter(Boolean);
    return { ...policy, allowedContracts: list.length ? list : undefined };
  }, [policy, contractsText]);

  const verdict = useMemo(() => {
    if (!xdrIn.trim()) return null;
    try {
      const tx = parseInner(xdrIn.trim(), effective.networkPassphrase);
      const fee = totalBumpFee(tx);
      checkPolicy(tx, effective, SPONSOR_DEMO, Math.floor(Date.now() / 1000));
      if (fee > effective.maxFeeStroops) throw new PolicyError(`fee ${fee} stroops exceeds the per-transaction cap of ${effective.maxFeeStroops}`, 400, "fee_too_high");
      return { ok: true as const, fee, ops: tx.operations.map((o) => o.type), source: tx.source };
    } catch (e) {
      return {
        ok: false as const,
        error: e instanceof Error ? e.message : String(e),
        status: e instanceof PolicyError ? e.status : 400,
        code: e instanceof PolicyError ? e.code : "policy_violation",
      };
    }
  }, [xdrIn, effective]);

  const config = { port: 8787, corsOrigin: "https://your-app.example", rpcUrl: "https://soroban-testnet.stellar.org", policy: effective };

  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-3.5">
          <a className="text-sm font-semibold text-indigo underline" href="https://github.com/circleboyslimited/sponsorgate" target="_blank" rel="noreferrer">
            GitHub
          </a>
        </div>
      </header>
      <section className="mx-auto max-w-7xl px-5 py-8">
        <h1 className="text-4xl font-extrabold tracking-tight">Sponsor your users' fees. Only the ones you meant to.</h1>
        <p className="mt-2 max-w-3xl text-gray">
          Design a fee-bump policy, test real transactions against it, and export the config for the relayer. Checks run
          in your browser with the same code the relayer uses.
        </p>
      </section>

      <div className="mx-auto grid max-w-7xl gap-6 px-5 pb-16 lg:grid-cols-2">
        <section className="panel space-y-5 p-6">
          <h2 className="text-xl font-bold">1 · Policy</h2>
          <div>
            <p className="lab">Network</p>
            <select className="inp mt-1" value={policy.networkPassphrase} onChange={(e) => set("networkPassphrase", e.target.value)}>
              <option value={Networks.TESTNET}>Testnet</option>
              <option value={Networks.PUBLIC}>Mainnet</option>
            </select>
          </div>
          <div>
            <p className="lab">Sponsored operation types</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {OP_TYPES.map((t) => {
                const on = policy.allowedOperations.includes(t);
                return (
                  <button
                    key={t}
                    onClick={() => set("allowedOperations", on ? policy.allowedOperations.filter((x) => x !== t) : [...policy.allowedOperations, t])}
                    className={`rounded-full border px-3 py-1 font-mono text-xs ${on ? "border-indigo bg-indigo text-white" : "border-border text-gray"}`}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <p className="lab">Allowed contracts (one per line: C… or C…:function; empty = any)</p>
            <textarea className="inp mt-1 h-20 font-mono text-xs" value={contractsText} onChange={(e) => setContractsText(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            {(
              [
                ["Max operations", "maxOperations", 1],
                ["Max fee per tx (XLM)", "maxFeeStroops", STROOPS],
                ["Must expire within (s)", "maxValiditySeconds", 1],
                ["Daily budget (XLM)", "dailyBudgetStroops", STROOPS],
              ] as const
            ).map(([label, key, scale]) => (
              <label key={key} className="block">
                <span className="lab">{label}</span>
                <input
                  className="inp mt-1"
                  type="number"
                  min="0"
                  step="any"
                  value={(policy[key] as number) / scale}
                  onChange={(e) => set(key, Math.round(Number(e.target.value) * scale))}
                />
              </label>
            ))}
            <label className="block">
              <span className="lab">Rate limit (tx per account)</span>
              <input className="inp mt-1" type="number" min="1" value={policy.rateLimit.max} onChange={(e) => set("rateLimit", { ...policy.rateLimit, max: Number(e.target.value) })} />
            </label>
            <label className="block">
              <span className="lab">…per window (s)</span>
              <input className="inp mt-1" type="number" min="1" value={policy.rateLimit.windowSeconds} onChange={(e) => set("rateLimit", { ...policy.rateLimit, windowSeconds: Number(e.target.value) })} />
            </label>
          </div>
          <details>
            <summary className="cursor-pointer text-sm font-bold text-indigo">sponsorgate.config.json</summary>
            <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-carbon p-4 font-mono text-[11px] text-indigo-soft">{JSON.stringify(config, null, 2)}</pre>
            <button className="act act-out mt-2" onClick={() => navigator.clipboard.writeText(JSON.stringify(config, null, 2))}>
              Copy config
            </button>
          </details>
          <details>
            <summary className="cursor-pointer text-sm font-bold text-indigo">Import an existing config</summary>
            <textarea
              className="inp mt-2 h-28 font-mono text-xs"
              placeholder="Paste sponsorgate.config.json (or just its policy)"
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button className="act act-ind" disabled={!importText.trim()} onClick={() => importConfig(importText)}>
                Load into form
              </button>
              <label className="act act-out cursor-pointer">
                Upload file…
                <input
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (file) importConfig(await file.text());
                    e.target.value = "";
                  }}
                />
              </label>
              {importMsg && <span className={`text-sm ${importMsg.ok ? "text-pass" : "text-fail"}`}>{importMsg.text}</span>}
            </div>
          </details>
        </section>

        <section className="space-y-6">
          <div className="panel p-6">
            <h2 className="text-xl font-bold">2 · Test a transaction</h2>
            <p className="mt-1 text-sm text-gray">Paste a user-signed XDR, or generate one:</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {(
                [
                  ["call", "Allowed contract call"],
                  ["payment", "XLM payment"],
                  ["setOptions", "setOptions (dangerous)"],
                  ["slow", "Expires in 24h"],
                ] as const
              ).map(([k, l]) => (
                <button key={k} className="act act-out text-xs" onClick={() => setXdrIn(makeSample(k, effective.allowedContracts?.[0] ?? "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"))}>
                  {l}
                </button>
              ))}
            </div>
            <textarea className="inp mt-3 h-32 font-mono text-[11px]" placeholder="AAAAAgAAAA…" value={xdrIn} onChange={(e) => setXdrIn(e.target.value)} />
            {verdict &&
              (verdict.ok ? (
                <div className="mt-4 rounded-xl border border-pass/30 bg-pass/5 p-4">
                  <p className="font-bold text-pass">✓ Would be sponsored</p>
                  <p className="mt-1 text-sm text-gray">
                    {verdict.ops.join(", ")} from <span className="font-mono">{verdict.source.slice(0, 6)}…</span> · sponsor pays{" "}
                    <b className="text-carbon">{(verdict.fee / STROOPS).toFixed(7).replace(/0+$/, "")} XLM</b> ({verdict.fee} stroops)
                  </p>
                </div>
              ) : (
                <div className="mt-4 rounded-xl border border-fail/30 bg-fail/5 p-4">
                  <p className="font-bold text-fail">
                    ✗ Rejected ({verdict.status}) <code className="ml-1 rounded bg-fail/10 px-1.5 py-0.5 font-mono text-xs">{verdict.code}</code>
                  </p>
                  <p className="mt-1 text-sm">{verdict.error}</p>
                </div>
              ))}
          </div>
          <LiveRelayer />
        </section>
      </div>
    </div>
  );
}

function LiveRelayer() {
  const [url, setUrl] = useState("http://localhost:8787");
  const [status, setStatus] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="panel p-6">
      <h2 className="text-xl font-bold">3 · Connect to a running relayer</h2>
      <p className="mt-1 text-sm text-gray">
        Run it with <code className="font-mono">SPONSOR_SECRET=S… node dist/bin.js sponsorgate.config.json</code>, then check its status here.
      </p>
      <div className="mt-3 flex gap-2">
        <input className="inp font-mono text-xs" value={url} onChange={(e) => setUrl(e.target.value)} />
        <button
          className="act act-ind shrink-0"
          onClick={async () => {
            setErr(null);
            try {
              const res = await fetch(`${url.replace(/\/$/, "")}/status`);
              setStatus(JSON.stringify(await res.json(), null, 2));
            } catch {
              setStatus(null);
              setErr("Couldn't reach the relayer (is it running, and does its corsOrigin allow this page?).");
            }
          }}
        >
          Check status
        </button>
      </div>
      {err && <p className="mt-3 text-sm text-fail">{err}</p>}
      {status && <pre className="mt-3 max-h-60 overflow-auto rounded-lg bg-carbon p-4 font-mono text-[11px] text-indigo-soft">{status}</pre>}
    </div>
  );
}
