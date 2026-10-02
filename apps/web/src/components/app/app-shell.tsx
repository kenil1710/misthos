"use client";

import { Menu } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Wordmark } from "@/components/brand/wordmark";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { AppSidebar, type ShellProgram } from "./app-sidebar";

/** Owner app frame: fixed sidebar on desktop, a top bar with a menu sheet below 1024px. */
export function AppShell({
  programs,
  founder,
  address,
  children,
}: {
  programs: ShellProgram[];
  founder: boolean;
  address: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      {/* The column spans the page height; the sidebar inside it stays put while the content scrolls. */}
      <div className="bg-sidebar hidden w-60 shrink-0 border-r lg:block">
        <aside className="sticky top-0 h-dvh">
          <AppSidebar programs={programs} founder={founder} address={address} />
        </aside>
      </div>
      <header className="bg-background sticky top-0 z-30 flex h-14 items-center justify-between border-b px-4 lg:hidden">
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
              onNavigate={() => setOpen(false)}
            />
          </SheetContent>
        </Sheet>
        <Link href="/app" aria-label="Misthos home" className="rounded-md">
          <Wordmark />
        </Link>
        <ThemeToggle />
      </header>
      <main id="main" className="min-w-0 flex-1">
        <div className="mx-auto w-full max-w-[1120px] px-4 py-8 sm:px-8 lg:py-10">{children}</div>
      </main>
    </div>
  );
}
