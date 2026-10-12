"use client";

import {
  DEFAULT_NETWORK,
  NETWORK_COOKIE,
  NETWORK_SHORT,
  parseNetwork,
} from "@misthos/shared/network";
import type { ChainKey } from "@misthos/shared/chains";
import { ChevronDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { useSyncExternalStore } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useProgramNetwork } from "./web3/network";

const EVENT = "misthos:network";
const YEAR = 60 * 60 * 24 * 365;

/** The visitor's network as the pre-paint script set it on <html> (cookie, else localStorage, else testnet). */
function read(): ChainKey {
  return parseNetwork(document.documentElement.dataset.network);
}
function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}

/** Remember the choice (cookie for the server, localStorage as a fallback) and apply it at once. */
export function rememberNetwork(key: ChainKey) {
  const secure = location.protocol === "https:" ? "; secure" : "";
  document.cookie = `${NETWORK_COOKIE}=${key}; path=/; max-age=${YEAR}; samesite=lax${secure}`;
  try {
    localStorage.setItem(NETWORK_COOKIE, key);
  } catch {
    // Storage blocked (private mode): the cookie still carries it.
  }
  document.documentElement.dataset.network = key;
  window.dispatchEvent(new Event(EVENT));
}

/** The selected network, re-rendering when it changes. `initial` is what the server rendered with. */
export function useSelectedNetwork(initial: ChainKey = DEFAULT_NETWORK): ChainKey {
  return useSyncExternalStore(subscribe, read, () => initial);
}

const OPTIONS: { key: ChainKey; title: string; detail: string }[] = [
  { key: "arc-testnet", title: "Arc Testnet", detail: "Test USDC. Free to try." },
  { key: "arc-mainnet", title: "Arc Mainnet", detail: "Real USDC." },
];

export function NetworkDot({ chain, className }: { chain: ChainKey; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        chain === "arc-mainnet" ? "bg-brand" : "bg-warning",
        className,
      )}
    />
  );
}

/**
 * The header's network badge and switch: Testnet or Mainnet, remembered per visitor (default Testnet). Lists, public
 * pages and metrics follow it. On a campaign's pages it shows that campaign's network instead (a campaign never
 * changes network).
 */
export function NetworkSwitch({
  initial,
  program: programProp,
  className,
}: {
  /** The network the server rendered with (from the cookie). */
  initial?: ChainKey;
  /** The campaign whose page this is, when the header sits outside its ProgramNetwork. */
  program?: string | null;
  className?: string;
}) {
  const router = useRouter();
  const selected = useSelectedNetwork(initial);
  const context = useProgramNetwork();
  const program = programProp ? parseNetwork(programProp) : context;
  const pill =
    "bg-card text-foreground inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium whitespace-nowrap";
  if (program)
    return (
      <span
        className={cn(pill, className)}
        title={`This campaign runs on ${program === "arc-mainnet" ? "Arc Mainnet (real USDC)" : "Arc Testnet (test USDC)"}`}
        data-testid="network-badge"
      >
        <NetworkDot chain={program} />
        <span className="sr-only">Network: </span>
        {NETWORK_SHORT[program]}
      </span>
    );
  return (
    // Non-modal: the rest of the page isn't hidden from assistive tech while this small menu is open.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        className={cn(
          pill,
          "hover:bg-muted focus-visible:ring-ring/50 outline-none focus-visible:ring-[3px]",
          className,
        )}
        aria-label={`Network: ${NETWORK_SHORT[selected]}. Change network`}
        data-testid="network-switch"
      >
        {/* Shown by html[data-network] (set before paint), so cached pages never flash the other network. */}
        {OPTIONS.map((o) => (
          <span
            key={o.key}
            className={cn(
              "items-center gap-1.5",
              o.key === "arc-mainnet" ? "net-mainnet inline-flex" : "net-testnet inline-flex",
            )}
          >
            <NetworkDot chain={o.key} />
            {NETWORK_SHORT[o.key]}
          </span>
        ))}
        <ChevronDown className="text-muted-foreground size-3" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
          Show campaigns on
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={selected}
          onValueChange={(v) => {
            const key = parseNetwork(v);
            if (key === selected) return;
            rememberNetwork(key);
            router.refresh();
          }}
        >
          {OPTIONS.map((o) => (
            <DropdownMenuRadioItem key={o.key} value={o.key} className="items-start">
              <span className="grid gap-0.5">
                <span className="flex items-center gap-2 font-medium">
                  <NetworkDot chain={o.key} />
                  {o.title}
                </span>
                <span className="text-muted-foreground text-xs">{o.detail}</span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Pre-paint: put the visitor's network on <html> before anything renders (cookie, else localStorage, else testnet). */
export const NETWORK_SCRIPT = `(function(){var d=document.documentElement,k="${NETWORK_COOKIE}",v;try{var m=document.cookie.match(/(?:^|; )${NETWORK_COOKIE}=([^;]+)/);v=m&&m[1];if(!v){v=localStorage.getItem(k);if(v==="arc-mainnet")document.cookie=k+"="+v+"; path=/; max-age=${YEAR}; samesite=lax"}}catch(e){}d.dataset.network=v==="arc-mainnet"?"arc-mainnet":"arc-testnet"})()`;
