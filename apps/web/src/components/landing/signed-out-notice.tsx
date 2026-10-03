"use client";

import { CheckCircle2, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

/** "You're signed out", shown once on the landing page after signing out; the flag is removed from the URL. */
export function SignedOutNotice() {
  const params = useSearchParams();
  // Rendered on the client only (useSearchParams under Suspense on a static page), so this can read the URL.
  const [shown, setShown] = useState(() => params.get("signed_out") !== null);
  useEffect(() => {
    if (!params.get("signed_out")) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("signed_out");
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  }, [params]);
  if (!shown) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-20 z-50 flex justify-center px-4">
      <div
        role="status"
        className="bg-card shadow-lift animate-in fade-in slide-in-from-top-2 pointer-events-auto flex items-center gap-3 rounded-full py-2 pr-2 pl-4 text-sm"
      >
        <CheckCircle2 className="text-success size-4" strokeWidth={1.75} aria-hidden="true" />
        You&apos;re signed out.
        <button
          type="button"
          onClick={() => setShown(false)}
          aria-label="Dismiss"
          className="text-muted-foreground hover:text-foreground rounded-full p-1"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
