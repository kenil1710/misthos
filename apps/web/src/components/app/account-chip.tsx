"use client";

import { shortHex } from "@misthos/shared/money";
import { ChevronsUpDown, Copy, ExternalLink, LogOut } from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Identicon } from "@/components/ui-kit/identicon";
import { explorerAddress } from "@/lib/landing-links";
import { cn } from "@/lib/utils";
import { signOut } from "./sign-out-button";

export type AccountTone = "ready" | "warning" | "off" | "busy";
const DOT: Record<AccountTone, string> = {
  ready: "bg-success",
  warning: "bg-warning",
  off: "bg-muted-foreground/50",
  busy: "bg-muted-foreground/60 animate-pulse",
};

/**
 * The signed-in account as one compact chip: identicon, short address (or @handle) and, for owners, a wallet
 * status dot with a tooltip. Clicking opens the account menu. No wallet code: wallet actions are passed in.
 */
export function AccountChip({
  kind,
  address,
  handle,
  status,
  walletItems,
  extraItems,
  className,
  align = "start",
  side = "top",
}: {
  kind: "owner" | "contributor";
  /** The owner's wallet address. */
  address?: string;
  /** The contributor's X handle (without @). */
  handle?: string;
  status?: { tone: AccountTone; text: string };
  /** Wallet actions (switch account, connect, switch network), from the wallet island. */
  walletItems?: ReactNode;
  extraItems?: ReactNode;
  className?: string;
  align?: "start" | "end";
  side?: "top" | "bottom";
}) {
  const label = address ? shortHex(address) : `@${handle}`;
  const full = address ?? `@${handle}`;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Account ${full}${status ? `, ${status.text}` : ""}`}
        className={cn(
          "hover:bg-card/80 focus-visible:ring-ring/50 flex min-w-0 items-center gap-2.5 rounded-xl px-2 py-1.5 text-left text-sm transition-colors outline-none focus-visible:ring-3",
          className,
        )}
      >
        <span className="relative">
          <Identicon seed={full} />
          {status ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className={cn(
                    "ring-background absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2",
                    DOT[status.tone],
                  )}
                />
              </TooltipTrigger>
              <TooltipContent side="top">{status.text}</TooltipContent>
            </Tooltip>
          ) : null}
        </span>
        <span className={cn("min-w-0 flex-1 truncate", address && "font-mono text-[13px]")}>
          {label}
        </span>
        <ChevronsUpDown
          className="text-muted-foreground size-3.5 shrink-0"
          strokeWidth={1.5}
          aria-hidden="true"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} side={side} className="w-60">
        <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
          {kind === "owner" ? "Signed in with" : "Signed in with X as"}{" "}
          <span className={cn("text-foreground", address && "font-mono")}>{label}</span>
          {status ? <span className="mt-0.5 block">{status.text}</span> : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {address ? (
          <>
            <DropdownMenuItem
              onSelect={() =>
                navigator.clipboard
                  .writeText(address)
                  .then(() => toast.success("Address copied"))
                  .catch(() => toast.error("Couldn't copy the address"))
              }
            >
              <Copy className="size-4" strokeWidth={1.5} />
              Copy address
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a href={explorerAddress(address)} target="_blank" rel="noreferrer">
                <ExternalLink className="size-4" strokeWidth={1.5} />
                View on explorer
              </a>
            </DropdownMenuItem>
          </>
        ) : (
          <DropdownMenuItem asChild>
            <a href={`https://x.com/${handle}`} target="_blank" rel="noreferrer">
              <ExternalLink className="size-4" strokeWidth={1.5} />
              View @{handle} on X
            </a>
          </DropdownMenuItem>
        )}
        {walletItems}
        {extraItems}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut(kind)}>
          <LogOut className="size-4" strokeWidth={1.5} />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
