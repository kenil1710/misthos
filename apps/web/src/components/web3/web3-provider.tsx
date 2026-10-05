"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { WagmiContext, WagmiProvider } from "wagmi";
import { classifyWalletError, isWalletNoise, WALLET_NOTICE_EVENT } from "@/lib/wallet-errors";
import { ConnectDialog } from "./connect-dialog";
import { getQueryClient, getWalletConfig } from "./wallet-config";

type WalletUi = { openConnect: () => void };
const WalletUiContext = createContext<WalletUi | null>(null);

/** Open the wallet picker from any button inside a Web3Provider. */
export function useWalletUi(): WalletUi {
  const ui = useContext(WalletUiContext);
  if (!ui) throw new Error("useWalletUi must be used inside <Web3Provider>");
  return ui;
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

/** wagmi with our own connect dialog. One config per tab, so several providers on a page share one connection. */
export function Web3Provider({ children }: { children: ReactNode }) {
  const [config] = useState(getWalletConfig);
  const [queryClient] = useState(getQueryClient);
  const [open, setOpen] = useState(false);
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
  const ui = useMemo(() => ({ openConnect: () => setOpen(true) }), []);
  const inner = (
    <QueryClientProvider client={queryClient}>
      <WalletUiContext.Provider value={ui}>
        {children}
        <ConnectDialog open={open} onOpenChange={setOpen} />
      </WalletUiContext.Provider>
    </QueryClientProvider>
  );
  return first ? (
    <WagmiProvider config={config}>{inner}</WagmiProvider>
  ) : (
    <WagmiContext.Provider value={config}>{inner}</WagmiContext.Provider>
  );
}
