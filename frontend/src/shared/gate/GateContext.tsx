import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { apiGet } from "../api/client";
import type { GateStatus } from "../api/types";

interface GateContextValue {
  /** null = 检测中 */
  status: GateStatus | null;
  error: string | null;
  refresh: () => void;
}

const GateContext = createContext<GateContextValue>({
  status: null,
  error: null,
  refresh: () => {},
});

export function GateProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<GateStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    apiGet<GateStatus>("/api/gate/status")
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [tick]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  return <GateContext.Provider value={{ status, error, refresh }}>{children}</GateContext.Provider>;
}

export function useGate(): GateContextValue {
  return useContext(GateContext);
}
