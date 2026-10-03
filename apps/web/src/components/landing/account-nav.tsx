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
 * The landing header's account area. Signed out: "Sign in" and "Start a program". Signed in: who you are and
 * "Open app", which goes to your programs (owner) or the programs you joined (contributor). Same width either
 * way, so swapping after load doesn't shift the header.
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
  const who = hint.o ?? `@${hint.c}`;
  return (
    <>
      <span
        className="text-muted-foreground hidden items-center gap-2 px-2 text-sm sm:inline-flex"
        title={hint.o && hint.c ? `${hint.o} · @${hint.c}` : who}
      >
        <span
          aria-hidden="true"
          className="bg-muted text-foreground flex size-6 items-center justify-center rounded-full border text-[11px] font-medium"
        >
          {(hint.c ?? hint.o!.slice(2, 3)).slice(0, 1).toUpperCase()}
        </span>
        <span className={hint.o ? "font-mono text-[13px]" : ""}>{who}</span>
      </span>
      <Button asChild size="sm" className="ml-1">
        <Link href={hint.o ? "/app" : "/c"} prefetch={false}>
          Open app
        </Link>
      </Button>
    </>
  );
}
