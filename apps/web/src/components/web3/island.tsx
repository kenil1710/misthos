"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";

/** Resolves once the page has loaded and the main thread has a quiet moment (at most 1.5 s later). */
let idle: Promise<void> | null = null;
function afterLoadIdle(): Promise<void> {
  idle ??= new Promise<void>((resolve) => {
    const settle = () =>
      "requestIdleCallback" in window
        ? window.requestIdleCallback(() => resolve(), { timeout: 1500 })
        : setTimeout(resolve, 200);
    if (document.readyState === "complete") settle();
    else window.addEventListener("load", settle, { once: true });
  });
  return idle;
}

/**
 * A wallet-dependent component, wrapped in its own provider (all providers share one wagmi config, so they share
 * one connection). Its code (wagmi, viem, the connectors) is fetched only once the page has loaded and is idle, and
 * only once the component is on screen, so wallet code never holds up a page and isn't loaded
 * for wallet UI nobody scrolls to. `placeholder` holds the component's space meanwhile, so nothing shifts.
 */
export function walletIsland<P extends object>(
  load: () => Promise<ComponentType<P>>,
  placeholder: ReactNode = null,
): ComponentType<P> {
  const Loaded = dynamic(
    async () => {
      await afterLoadIdle();
      const [{ Web3Provider }, C] = await Promise.all([import("./web3-provider"), load()]);
      function Island(props: P) {
        return (
          <Web3Provider>
            <C {...props} />
          </Web3Provider>
        );
      }
      return Island;
    },
    { ssr: false, loading: () => <>{placeholder}</> },
  );
  function Gate(props: P) {
    const ref = useRef<HTMLSpanElement>(null);
    const [near, setNear] = useState(false);
    useEffect(() => {
      const el = ref.current?.parentElement;
      if (!el || !("IntersectionObserver" in window)) return setNear(true);
      const io = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            setNear(true);
            io.disconnect();
          }
        },
        { rootMargin: "0px" },
      );
      io.observe(el);
      return () => io.disconnect();
    }, []);
    if (near) return <Loaded {...props} />;
    return (
      <>
        <span ref={ref} hidden />
        {placeholder}
      </>
    );
  }
  return Gate;
}
