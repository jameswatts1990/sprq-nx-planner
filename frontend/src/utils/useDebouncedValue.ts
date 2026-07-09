import { useEffect, useState } from "react";

/** Debounces a fast-changing value (e.g. a search box or run-design settings) so
 * dependent queries don't re-fire on every keystroke. */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
