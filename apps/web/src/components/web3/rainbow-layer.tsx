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
  return null;
}
