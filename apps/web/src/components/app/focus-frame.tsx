import Link from "next/link";
import type { ReactNode } from "react";
import { Wordmark } from "@/components/brand/wordmark";
import { ThemeToggle } from "@/components/theme-toggle";

/**
 * Full-screen guided flows (new program wizard, "Your program is ready", vault setup) leave the app rail behind:
 * the URL patterns below render without the shell, and each page draws its own FocusHeader.
 */
const FOCUS_ROUTES = [
  /^\/app\/programs\/new\/?$/,
  /^\/app\/programs\/[0-9a-f-]{36}\/(ready|setup)\/?$/,
];
export const isFocusRoute = (path: string) => FOCUS_ROUTES.some((r) => r.test(path));

/**
 * The one header of a guided flow: the logo (back to the app home), the flow's progress in the middle, and a calm
 * way out on the right. Sticky, so progress and the exit stay in reach on long steps.
 */
export function FocusHeader({
  progress,
  exit,
  aside,
  status,
}: {
  /** Usually a compact stepper or "Step 2 of 4". */
  progress?: ReactNode;
  /** The way out, e.g. "Save and exit". */
  exit?: ReactNode;
  /** Small status text before the exit (e.g. "Draft saved"). */
  aside?: ReactNode;
  /** A live status that matters for the flow, e.g. the wallet chip during transactions. */
  status?: ReactNode;
}) {
  return (
    <header className="bg-background/85 supports-[backdrop-filter]:bg-background/75 sticky top-0 z-30 border-b supports-[backdrop-filter]:backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-[1240px] items-center gap-4 px-4 sm:px-8">
        <Link href="/app" aria-label="Misthos app home" className="shrink-0 rounded-md">
          <Wordmark />
        </Link>
        <div className="flex min-w-0 flex-1 justify-center">{progress}</div>
        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          {aside ? (
            <span className="text-muted-foreground hidden text-xs xl:inline">{aside}</span>
          ) : null}
          {status ? <span className="hidden items-center sm:flex">{status}</span> : null}
          {exit}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

/** The page body of a guided flow: centered, generous, with room for a sticky action bar. */
export function FocusMain({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <main id="main" className={className ?? "mx-auto w-full max-w-[1240px] px-4 pb-16 sm:px-8"}>
      {children}
    </main>
  );
}
