"use client";

import { Button } from "@/components/ui/button";

/** Shown when a page fails to load. Says what happened and offers the one useful next step. */
export function ErrorPanel({ reset, what = "this page" }: { reset: () => void; what?: string }) {
  return (
    <div role="alert" className="rounded-lg border p-8">
      <h1 className="text-lg font-medium">Couldn&apos;t load {what}</h1>
      <p className="text-muted-foreground mt-1 max-w-lg text-sm">
        Misthos couldn&apos;t reach its database or the Arc network just now. Your data is safe;
        nothing was changed.
      </p>
      <Button className="mt-4" size="sm" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
