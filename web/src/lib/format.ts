const UNIT = 10_000_000n;

/** Base units (7 decimals) → human string, trimming trailing zeros. */
export function fromUnits(value: bigint | number | string, decimals = 7): string {
  const v = BigInt(value);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = (abs % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole.toLocaleString("en-US")}${frac ? `.${frac}` : ""}`;
}

/** Human decimal string → base units. Throws on invalid or over-precise input. */
export function toUnits(input: string, decimals = 7): bigint {
  const s = input.trim().replace(/,/g, "");
  if (!new RegExp(`^(?=\\.?\\d)\\d*(\\.\\d{1,${decimals}})?$`).test(s)) {
    throw new Error(`Enter a positive number with at most ${decimals} decimals.`);
  }
  const [w, f = ""] = s.split(".");
  return BigInt(w || "0") * 10n ** BigInt(decimals) + BigInt((f + "0".repeat(decimals)).slice(0, decimals));
}

export const short = (a?: string | null, n = 4) => (!a ? "" : a.length <= n * 2 + 1 ? a : `${a.slice(0, n)}…${a.slice(-n)}`);

export function timeLeft(unixSeconds: bigint | number, now = Date.now() / 1000): string {
  const s = Number(unixSeconds) - now;
  const abs = Math.abs(s);
  const fmt =
    abs >= 86_400 ? `${Math.floor(abs / 86_400)}d` : abs >= 3_600 ? `${Math.floor(abs / 3_600)}h` : `${Math.max(1, Math.floor(abs / 60))}m`;
  return s >= 0 ? `in ${fmt}` : `${fmt} ago`;
}

export const dateOf = (unixSeconds: bigint | number) =>
  new Date(Number(unixSeconds) * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

export const XLM = UNIT;
