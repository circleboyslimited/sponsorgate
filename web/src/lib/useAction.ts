import { useState } from "react";

/** Wraps an async action with busy/error/success state for buttons and forms. */
export function useAction() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; hash?: string } | null>(null);

  async function run<T>(label: string, fn: () => Promise<T>, success?: (r: T) => { text: string; hash?: string }) {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      const r = await fn();
      if (success) setNotice(success(r));
      return r;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return undefined;
    } finally {
      setBusy(null);
    }
  }
  return { busy, error, notice, run, clear: () => (setError(null), setNotice(null)) };
}
