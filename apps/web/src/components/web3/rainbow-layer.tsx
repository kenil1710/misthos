"use client";

import "@rainbow-me/rainbowkit/styles.css";
import { RainbowKitProvider, useConnectModal } from "@rainbow-me/rainbowkit";
import { useEffect, useRef } from "react";
import { chain } from "./wallet-config";
import { walletTheme } from "./wallet-theme";

/**
 * RainbowKit's wallet list, loaded on the first "Connect wallet". Each bump of `request` opens it once (as soon as
 * RainbowKit can: right after a disconnect it waits for the disconnect to settle).
 */
export function RainbowLayer({
  request,
  onOpenChange,
}: {
  request: number;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <RainbowKitProvider
      theme={walletTheme}
      modalSize="compact"
      initialChain={chain}
      appInfo={{ appName: "Misthos", learnMoreUrl: "/docs/contributors#getting-paid" }}
    >
      <Opener request={request} onOpenChange={onOpenChange} />
    </RainbowKitProvider>
  );
}

function Opener({
  request,
  onOpenChange,
}: {
  request: number;
  onOpenChange: (open: boolean) => void;
}) {
  const { openConnectModal, connectModalOpen } = useConnectModal();
  const handled = useRef(0);
  useEffect(() => {
    if (request <= handled.current || !openConnectModal) return;
    handled.current = request;
    openConnectModal();
  }, [request, openConnectModal]);
  useEffect(() => onOpenChange(connectModalOpen), [connectModalOpen, onOpenChange]);
  useDecorativeIcons(connectModalOpen);
  return null;
}

/**
 * RainbowKit draws wallet icons as role="img" with no name, next to the wallet's name in the same button. Mark the
 * unnamed ones decorative so screen readers (and axe) don't announce an empty image before every wallet.
 */
function useDecorativeIcons(open: boolean) {
  useEffect(() => {
    if (!open) return;
    const fix = () =>
      document
        .querySelectorAll('[data-rk] [role="img"]:not([aria-label]):not([aria-hidden])')
        .forEach((el) => el.setAttribute("aria-hidden", "true"));
    fix();
    const mo = new MutationObserver(fix);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [open]);
}
