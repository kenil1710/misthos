"use client";

import { Menu } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Wordmark } from "@/components/brand/wordmark";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { AppSidebar, type ShellProgram } from "./app-sidebar";
import { isFocusRoute } from "./focus-frame";
import { NeedsBell, RoundPill, TopBar } from "./top-bar";

/**
 * Owner app frame: an icon + label rail on the left (program switcher on top, wallet chip at the bottom) and a top
 * bar with the round pill, "Needs you", sharing and theme. Below 1024px: a header with the menu sheet.
 */
export function AppShell({
  programs,
  founder,
  address,
  contributor = false,
  children,
}: {
  programs: ShellProgram[];
  founder: boolean;
  address: string;
  contributor?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  // The rail is CSS-hidden below 1024px; don't mount its wallet status there (it would load wagmi for nothing).
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const sync = () => setDesktop(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  const path = usePathname();
  const currentId = /^\/app\/programs\/([0-9a-f-]{36})/.exec(path)?.[1];
  const current = programs.find((p) => p.id === currentId);
  const allNeeds = current
    ? current.needs
    : programs.flatMap((p) => p.needs.map((n) => ({ ...n, programName: p.name })));
  // Guided flows take the whole screen; they draw their own header (FocusHeader).
  if (isFocusRoute(path)) return <div className="flex min-h-dvh flex-col">{children}</div>;
  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <div className="bg-sidebar hidden w-64 shrink-0 lg:block">
        <aside className="sticky top-0 h-dvh">
          <AppSidebar
            programs={programs}
            founder={founder}
            address={address}
            contributor={contributor}
            wallet={desktop}
          />
        </aside>
      </div>
      <header className="bg-background/85 supports-[backdrop-filter]:bg-background/75 sticky top-0 z-30 flex h-14 items-center justify-between gap-2 px-3 supports-[backdrop-filter]:backdrop-blur-md lg:hidden">
        <div className="flex items-center gap-1">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Open menu">
                <Menu className="size-5" strokeWidth={1.5} />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="bg-sidebar w-72 p-0">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <AppSidebar
                programs={programs}
                founder={founder}
                address={address}
                contributor={contributor}
                onNavigate={() => setOpen(false)}
              />
            </SheetContent>
          </Sheet>
          <Link href="/app" aria-label="Misthos app home" className="rounded-md">
            <Wordmark />
          </Link>
        </div>
        <div className="flex items-center">
          <NeedsBell needs={allNeeds} />
          <ThemeToggle />
        </div>
      </header>
      <main id="main" className="min-w-0 flex-1">
        <div className="mx-auto w-full max-w-[1160px] px-4 pb-16 sm:px-8 lg:px-10">
          <TopBar current={current} programs={programs} />
          {current?.roundPill ? (
            <div className="pt-4 lg:hidden">
              <RoundPill pill={current.roundPill} />
            </div>
          ) : null}
          <div className="grid grid-cols-[minmax(0,1fr)] pt-6 lg:pt-4">{children}</div>
        </div>
      </main>
    </div>
  );
}
