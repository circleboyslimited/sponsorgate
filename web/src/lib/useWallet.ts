import { useCallback, useEffect, useState } from "react";
import { connectWallet, currentAddress } from "./stellar";

export function useWallet() {
  const [address, setAddress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    currentAddress().then(setAddress).catch(() => {});
  }, []);

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      const a = await connectWallet();
      setAddress(a);
      return a;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setConnecting(false);
    }
  }, []);

  return { address, connect, connecting, error, disconnect: () => setAddress(null) };
}
