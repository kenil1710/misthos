import Link from "next/link";
import { SiteHeader } from "@/components/app/site-header";
import { Button } from "@/components/ui/button";

export default function PublicLayout({ children }: LayoutProps<"/p">) {
  return (
    <>
      <SiteHeader
        right={
          <Button asChild variant="ghost" size="sm">
            <Link href="/app">Run a program</Link>
          </Button>
        }
      />
      <main
        id="main"
        className="mx-auto grid w-full max-w-6xl flex-1 grid-cols-[minmax(0,1fr)] gap-12 px-4 py-10 sm:px-6"
      >
        {children}
      </main>
    </>
  );
}
