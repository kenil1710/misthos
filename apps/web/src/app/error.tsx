"use client";

import Link from "next/link";
import { SiteHeader } from "@/components/app/site-header";
import { Button } from "@/components/ui/button";
import { ErrorPanel } from "@/components/ui-kit/error-panel";

/** Errors that escape a section's own boundary (e.g. in the app layout): same calm panel, plus a way out. */
export default function RootError({ reset }: { error: Error; reset: () => void }) {
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto grid w-full max-w-3xl flex-1 gap-4 px-4 py-16 sm:px-6">
        <ErrorPanel reset={reset} />
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href="/">Home</Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href="/docs">Docs</Link>
          </Button>
        </div>
      </main>
    </>
  );
}
