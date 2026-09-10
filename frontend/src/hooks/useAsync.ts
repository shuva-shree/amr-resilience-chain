import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../api/client";

export interface AsyncState<T> {
  data: T | undefined;
  loading: boolean;
  error: ApiError | null;
  /** true once at least one request has settled */
  loaded: boolean;
  refetch: () => void;
}

/**
 * Runs `fn` on mount and whenever `deps` change. Aborts in-flight requests on
 * change/unmount. Never falls back to stale/fake data — on error, `data` is
 * left as-is and `error` is populated for the UI to render a safe message.
 */
export function useAsync<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  deps: React.DependencyList,
): AsyncState<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [nonce, setNonce] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError(null);

    fnRef
      .current(controller.signal)
      .then((result) => {
        if (!active) return;
        setData(result);
        setError(null);
      })
      .catch((e) => {
        if (!active || controller.signal.aborted) return;
        setError(
          e instanceof ApiError
            ? e
            : new ApiError("UNKNOWN", "Something went wrong. Please try again.", 0),
        );
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
        setLoaded(true);
      });

    return () => {
      active = false;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  return { data, loading, error, loaded, refetch };
}
