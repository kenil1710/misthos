"use client";

import { useSyncExternalStore } from "react";

const noop = () => () => {};

/**
 * False on the server and during hydration, true after. Wallet state only exists in the browser (and starts
 * reconnecting immediately), so wallet UI renders a same-size placeholder until this is true: no hydration
 * mismatch, no layout shift.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
}
