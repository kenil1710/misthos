import Link from "next/link";
import { SiteHeader } from "@/components/app/site-header";
import { BrokenLinkArt } from "@/components/brand/illustrations";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Page not found", robots: { index: false } };

/** Every 404: say what probably happened and offer the places people usually meant to go. */
export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main
        id="main"
        className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-10 px-4 py-16 sm:px-6 sm:py-24 md:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)]"
      >
        <div>
          <p className="text-brand font-mono text-sm">404</p>
          <h1 className="display mt-3 text-[3rem] leading-[1.02] sm:text-[4.25rem]">
            Page <em>not found</em>
          </h1>
          <p className="text-soft mt-4 max-w-[52ch] text-[15px] leading-relaxed">
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
        </div>
        <BrokenLinkArt className="mx-auto hidden size-64 md:block lg:size-80" />
      </main>
    </>
  );
}
