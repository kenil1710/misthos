"use client";

import Link from "next/link";
import { useMemo, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";

type Hint = { o?: string; c?: string };

function parseHint(cookie: string): Hint | null {
  try {
    const raw = cookie.split("; ").find((c) => c.startsWith("misthos_hint="));
    if (!raw) return null;
    const h = JSON.parse(decodeURIComponent(decodeURIComponent(raw.slice(13)))) as Hint;
    return h.o || h.c ? h : null;
  } catch {
    return null;
  }
}

/**
 * The landing header's account area. Signed out: "Sign in" and "Start a program". Signed in: just "Open app", which
 * goes to your programs (owner) or the programs you joined (contributor). No wallet code loads here.
 */
export function AccountNav() {
  // The cookie string is the snapshot (stable while unchanged); the server renders the signed-out state.
  const cookie = useSyncExternalStore(
    () => () => {},
    () => document.cookie,
    () => "",
  );
  const hint = useMemo(() => parseHint(cookie), [cookie]);
  if (!hint)
    return (
      <>
        <Button asChild variant="ghost" size="sm" className="text-soft hidden sm:inline-flex">
          <Link href="/app" prefetch={false}>
            Sign in
          </Link>
        </Button>
        <Button asChild size="sm" className="ml-1">
          <Link href="/app" prefetch={false}>
            Start a program
          </Link>
        </Button>
      </>
    );
  // Signed in: just "Open app" (no address or avatar on the public site).
  return (
    <>
      <Button asChild size="sm" className="ml-1">
        <Link href={hint.o ? "/app" : "/c"} prefetch={false}>
          Open app
        </Link>
      </Button>
    </>
  );
}
