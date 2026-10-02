import Link from "next/link";
import type { ReactNode } from "react";
import { Wordmark } from "@/components/brand/wordmark";
import { ThemeToggle } from "@/components/theme-toggle";

export function SiteHeader({
  href = "/",
  nav,
  right,
}: {
  href?: string;
  nav?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <header className="border-b">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-6">
          <Link href={href} aria-label="Misthos home" className="rounded-md">
            <Wordmark />
          </Link>
          {nav ? (
            <nav aria-label="Main" className="hidden items-center gap-4 text-sm sm:flex">
              {nav}
            </nav>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          {right}
          <ThemeToggle />
        </div>
      </div>
      {/* Below 640px the links move to their own scrollable row instead of disappearing. */}
      {nav ? (
        <nav
          aria-label="Main"
          className="flex h-10 items-center gap-5 overflow-x-auto border-t px-4 text-sm whitespace-nowrap sm:hidden"
        >
          {nav}
        </nav>
      ) : null}
    </header>
  );
}
