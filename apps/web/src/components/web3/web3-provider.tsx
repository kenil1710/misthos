"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { useAccount, useAccountEffect, useSwitchChain, WagmiContext, WagmiProvider } from "wagmi";
import { classifyWalletError, isWalletNoise, WALLET_NOTICE_EVENT } from "@/lib/wallet-errors";
import { AccountDialog } from "./account-dialog";
import type { RainbowLayer as RainbowLayerType } from "./rainbow-layer";
import { chain, ensureRainbowConnectors, getQueryClient, getWalletConfig } from "./wallet-config";

type WalletUi = {
  /**
   * Disconnected: RainbowKit's wallet list. Connected: our own account panel (address, network, disconnect).
   * `fresh` always asks for the wallet list, e.g. right after a disconnect that hasn't settled yet.
   */
  openConnect: (opts?: { fresh?: boolean }) => void;
  /** Start fetching the wallet list (hover or focus on a Connect button), so the click opens it at once. */
  prefetchConnect: () => void;
  /** The wallet list is loading after a click. */
  opening: boolean;
};
const WalletUiContext = createContext<WalletUi | null>(null);

/** Open the wallet picker from any button inside a Web3Provider. */
export function useWalletUi(): WalletUi {
  const ui = useContext(WalletUiContext);
  if (!ui) throw new Error("useWalletUi must be used inside <Web3Provider>");
  return ui;
}

let layerModule: Promise<typeof RainbowLayerType> | undefined;
/** RainbowKit's connectors and modal, fetched once per tab. */
function loadLayer() {
  layerModule ??= Promise.all([ensureRainbowConnectors(), import("./rainbow-layer")]).then(
    ([, m]) => m.RainbowLayer,
  );
  return layerModule;
}

let guardInstalled = false;
/**
 * Wallet SDKs (WalletConnect especially) reject promises nobody awaits, e.g. "Proposal expired" when a QR code
 * times out. Those are expected outcomes, not crashes: swallow them before Next's error overlay or the console
 * sees them, and tell the open connect dialog so it can show a calm message with a retry.
 */
function installRejectionGuard() {
  if (guardInstalled || typeof window === "undefined") return;
  guardInstalled = true;
  const onRejection = (ev: PromiseRejectionEvent) => {
    if (!isWalletNoise(ev.reason)) return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    window.dispatchEvent(
      new CustomEvent(WALLET_NOTICE_EVENT, { detail: classifyWalletError(ev.reason) }),
    );
  };
  // Capture phase on window runs before the bubbling listeners Next's dev overlay registers.
  window.addEventListener("unhandledrejection", onRejection, { capture: true });
}

installRejectionGuard();
/**
 * Which island owns WagmiProvider (it restores and reconnects the wallet). Claimed during render, but only
 * `providerCommitted` is final: React can throw a render away (two islands resolving together under one Suspense
 * boundary), so an uncommitted claim expires after the current task and the retried render claims again.
 */
let providerCommitted = false;
let pendingClaim = false;
function claimProvider(): boolean {
  if (providerCommitted || pendingClaim) return false;
  pendingClaim = true;
  setTimeout(() => {
    pendingClaim = false;
  }, 0);
  return true;
}

/**
 * RainbowKit only connects. Our SIWE sign-in, account panel and wallet-fix dialogs stay ours. RainbowKit (and the
 * wallet SDKs behind it) loads on the first "Connect wallet", so pages stay light for people who never click it.
 * Wallet requests only ever follow a click: the one automatic step is offering Arc Testnet right after someone
 * connects a wallet that's on another network (never on a silent reconnect at page load).
 */
function WalletUiBridge({ children }: { children: ReactNode }) {
  const { isConnected } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const [accountOpen, setAccountOpen] = useState(false);
  const [Layer, setLayer] = useState<ComponentType<Parameters<typeof RainbowLayerType>[0]> | null>(
    null,
  );
  const [request, setRequest] = useState(0);
  const [opening, setOpening] = useState(false);
  const asked = useRef(false);

  const openList = useCallback(() => {
    asked.current = true;
    setRequest((r) => r + 1);
    if (Layer) return;
    setOpening(true);
    loadLayer()
      .then((L) => setLayer(() => L))
      .catch(() => toast("Couldn't load the wallet list. Check your connection and try again."))
      .finally(() => setOpening(false));
  }, [Layer]);
  const prefetchConnect = useCallback(() => {
    if (!isConnected) void loadLayer().catch(() => {});
  }, [isConnected]);

  useAccountEffect({
    onConnect({ chainId, isReconnected }) {
      if (isReconnected || !asked.current) return;
      asked.current = false;
      // wagmi adds the chain (wallet_addEthereumChain) when the wallet doesn't know it yet.
      if (chainId !== chain.id)
        switchChainAsync({ chainId: chain.id }).catch((e) => {
          const err = classifyWalletError(e);
          if (err.kind !== "rejected" && err.kind !== "closed") toast(err.message);
        });
    },
  });

  // Rejections nobody awaited (WalletConnect's expiring proposals): a calm toast with a retry.
  useEffect(() => {
    const onNotice = (e: Event) => {
      const err = (e as CustomEvent<{ message: string }>).detail;
      toast(err.message, { action: { label: "Try again", onClick: openList } });
    };
    window.addEventListener(WALLET_NOTICE_EVENT, onNotice);
    return () => window.removeEventListener(WALLET_NOTICE_EVENT, onNotice);
  }, [openList]);

  const openConnect = useCallback(
    (opts?: { fresh?: boolean }) => {
      if (isConnected && !opts?.fresh) setAccountOpen(true);
      else openList();
    },
    [isConnected, openList],
  );
  const onListOpenChange = useCallback((open: boolean) => {
    if (open) asked.current = true;
  }, []);
  const ui = useMemo(
    () => ({ openConnect, prefetchConnect, opening }),
    [openConnect, prefetchConnect, opening],
  );
  return (
    <WalletUiContext.Provider value={ui}>
      {children}
      {Layer ? <Layer request={request} onOpenChange={onListOpenChange} /> : null}
      <AccountDialog open={accountOpen && isConnected} onOpenChange={setAccountOpen} />
    </WalletUiContext.Provider>
  );
}

/** wagmi + RainbowKit. One config per tab, so several providers on a page share one connection. */
export function Web3Provider({ children }: { children: ReactNode }) {
  const [config] = useState(getWalletConfig);
  const [queryClient] = useState(getQueryClient);
  // Several islands on a page share one config. The first restores and reconnects the wallet (WagmiProvider);
  // later ones only provide the context, since wagmi's provider would otherwise reset or re-run the connection.
  const [first] = useState(claimProvider);
  useEffect(() => {
    if (!first) return;
    providerCommitted = true;
    return () => {
      providerCommitted = false;
    };
  }, [first]);
  useEffect(installRejectionGuard, []);
  const inner = (
    <QueryClientProvider client={queryClient}>
      <WalletUiBridge>{children}</WalletUiBridge>
    </QueryClientProvider>
  );
  return first ? (
    <WagmiProvider config={config}>{inner}</WagmiProvider>
  ) : (
    <WagmiContext.Provider value={config}>{inner}</WagmiContext.Provider>
  );
}
