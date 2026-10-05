"use client";

import { Wallet } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { USE_CONNECTED_WALLET_EVENT } from "@/lib/wallet-events";
import { hadWalletBefore } from "@/lib/wallets";

/**
 * Light stand-ins for the contributor pages' wallet UI. The wallet stack (wagmi, viem, connectors) only loads when
 * someone clicks a wallet button, or right away for a returning visitor whose wallet should reconnect silently.
 */
const impl = () => import("./wallet-impl");
const JoinWalletImpl = dynamic(() => impl().then((m) => m.JoinWalletImpl), {
  ssr: false,
  loading: () => <ConnectButton label="Connect your payout wallet" busy />,
});
const ChangeWalletImpl = dynamic(() => impl().then((m) => m.ChangeWalletImpl), {
  ssr: false,
  loading: () => <ConnectButton label="Change payout wallet" busy small />,
});
const PayoutWalletNoteImpl = dynamic(() => impl().then((m) => m.PayoutWalletNoteImpl), {
  ssr: false,
});

function ConnectButton({
  label,
  busy = false,
  small = false,
  onClick,
}: {
  label: string;
  busy?: boolean;
  small?: boolean;
  onClick?: () => void;
}) {
  return (
    <Button
      type="button"
      variant={small ? "outline" : "default"}
      size={small ? "sm" : "default"}
      disabled={busy}
      onClick={onClick}
      className={small ? "w-fit gap-2" : "w-full gap-2 sm:w-auto"}
    >
      {small ? null : <Wallet className="size-4" strokeWidth={1.5} aria-hidden="true" />}
      {label}
    </Button>
  );
}

function useReturningWallet() {
  const [returning, setReturning] = useState(false);
  useEffect(() => {
    if (!hadWalletBefore()) return;
    const go = () => setReturning(true);
    const idle = (window as { requestIdleCallback?: (cb: () => void) => number })
      .requestIdleCallback;
    if (idle) idle(go);
    else setTimeout(go, 200);
  }, []);
  return returning;
}

export function JoinWallet({ programSlug }: { programSlug: string }) {
  const [clicked, setClicked] = useState(false);
  const returning = useReturningWallet();
  if (!clicked && !returning)
    return (
      <div className="grid gap-4">
        <ConnectButton label="Connect your payout wallet" onClick={() => setClicked(true)} />
        <p className="text-muted-foreground text-xs leading-relaxed">
          You&apos;ll sign a message proving you control this wallet. It&apos;s free and
          doesn&apos;t send a transaction.
        </p>
      </div>
    );
  return <JoinWalletImpl programSlug={programSlug} autoOpen={clicked} />;
}

export function ChangeWallet(props: {
  programSlug: string;
  cooldownHours: number;
  currentWallet: string | null;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onUse = () => {
      setOpen(true);
      ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    };
    window.addEventListener(USE_CONNECTED_WALLET_EVENT, onUse);
    return () => window.removeEventListener(USE_CONNECTED_WALLET_EVENT, onUse);
  }, []);
  return (
    <div ref={ref}>
      {open ? (
        <ChangeWalletImpl {...props} onClose={() => setOpen(false)} />
      ) : (
        <ConnectButton label="Change payout wallet" small onClick={() => setOpen(true)} />
      )}
    </div>
  );
}

/** The Account card's "connected wallet differs" line, for returning visitors whose wallet extension reconnects. */
export function PayoutWalletNote({ expected }: { expected: string | null }) {
  const returning = useReturningWallet();
  if (!returning || !expected) return null;
  return <PayoutWalletNoteImpl expected={expected} />;
}
