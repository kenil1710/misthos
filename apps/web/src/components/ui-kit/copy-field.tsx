"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/** A read-only value (join link, address) with a copy button and a confirmation. */
export function CopyField({
  value,
  label,
  display,
}: {
  value: string;
  label: string;
  display?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="bg-muted/40 flex min-w-0 items-center gap-2 rounded-lg border py-1 pr-1 pl-3">
      <span className="min-w-0 flex-1 truncate font-mono text-[13px]" title={value}>
        {display ?? value}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={`Copy ${label}`}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            toast.success(`Copied ${label}`);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            toast.error("Couldn't copy. Select the text and copy it manually.");
          }
        }}
      >
        {copied ? (
          <Check className="size-4" strokeWidth={1.5} />
        ) : (
          <Copy className="size-4" strokeWidth={1.5} />
        )}
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}
