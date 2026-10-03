"use client";

import { Check, Copy, ExternalLink } from "lucide-react";
import { useState } from "react";
import { shortHex } from "@misthos/shared/money";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** Address or tx hash: 0x3a4f…9c21 with copy button and optional explorer link. */
export function HexValue({ value, href, label }: { value: string; href?: string; label: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable: the full value is still in the tooltip */
    }
  }
  return (
    <span className="inline-flex items-center gap-1 font-mono text-[13px]">
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0}>{shortHex(value)}</span>
        </TooltipTrigger>
        <TooltipContent className="font-mono">{value}</TooltipContent>
      </Tooltip>
      <button
        type="button"
        onClick={copy}
        aria-label={`Copy ${label}`}
        className="text-muted-foreground hover:text-foreground -my-1 inline-flex size-6 items-center justify-center rounded transition-colors duration-150"
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </button>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          aria-label={`View ${label} on explorer`}
          className="text-muted-foreground hover:text-foreground -my-1 inline-flex size-6 items-center justify-center rounded transition-colors duration-150"
        >
          <ExternalLink className="size-3.5" />
        </a>
      ) : null}
    </span>
  );
}
