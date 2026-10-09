"use client";

import dynamic from "next/dynamic";
import { hadWalletBefore } from "@/lib/wallets";
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
  placeholder: ReactNode | ((props: P) => ReactNode) = null,
): ComponentType<P> {
  const hold = (props: P) => (typeof placeholder === "function" ? placeholder(props) : placeholder);
  const Loaded = dynamic(
    async () => {
      await afterLoadIdle();
      const [{ Web3Provider }, C] = await Promise.all([
        import("./web3-provider"),
        load(),
        // A returning visitor: all connectors from the start, so the saved connection restores whatever wallet it
        // used. Everyone else gets RainbowKit's connectors on their first "Connect wallet".
        hadWalletBefore()
          ? Promise.all([import("./rainbow-connectors"), import("./wallet-config")]).then(
              ([r, c]) => c.preloadConnectors(r.rainbowConnectors()),
            )
          : null,
      ]);
      function Island(props: P) {
        return (
          <Web3Provider>
            <C {...props} />
          </Web3Provider>
        );
      }
      return Island;
    },
    { ssr: false, loading: () => <>{hold(lastProps as P)}</> },
  );
  let lastProps: P | undefined;
  function Gate(props: P) {
    lastProps = props;
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
        {hold(props)}
      </>
    );
  }
  return Gate;
}
