import Link from "next/link";
import { SiteHeader } from "@/components/app/site-header";
import { Button } from "@/components/ui/button";

/** Every 404: say what probably happened and offer the places people usually meant to go. */
export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-20 sm:px-6 sm:py-24">
        <p className="text-muted-foreground font-mono text-sm">404</p>
        <h1 className="mt-2 text-2xl font-medium tracking-[-0.02em]">Page not found</h1>
        <p className="text-soft mt-3 max-w-lg text-sm leading-relaxed">
          This link doesn&apos;t match a program, round or page. A program&apos;s join and audit
          pages only open once its owner publishes it, and links with a typo end up here too.
        </p>
        <div className="mt-8 flex flex-wrap gap-2">
          <Button asChild>
            <Link href="/app">Your programs</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/c">Programs you joined</Link>
          </Button>
          <Button asChild variant="ghost">
            <Link href="/">Home</Link>
          </Button>
          <Button asChild variant="ghost">
            <Link href="/docs">Docs</Link>
          </Button>
        </div>
      </main>
    </>
  );
}
