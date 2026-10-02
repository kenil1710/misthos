import Link from "next/link";
import { SiteHeader } from "@/components/app/site-header";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-24 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
        <p className="text-muted-foreground mt-2 max-w-md text-sm">
          This link doesn&apos;t match a program, round or page. Programs only have public pages
          once their owner publishes them.
        </p>
        <Button asChild className="mt-6" size="sm">
          <Link href="/">Go to Misthos</Link>
        </Button>
      </main>
    </>
  );
}
