import { ArrowRight, Lock } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

/** A program the signed-in owner isn't a member of (or that doesn't exist): say so, and point to what they can open. */
export function NoProgramAccess({ programs }: { programs: { id: string; name: string }[] }) {
  return (
    <section
      aria-labelledby="no-access-h"
      className="bg-card shadow-soft mx-auto mt-6 grid max-w-xl justify-items-start gap-4 rounded-[1.25rem] p-6 sm:p-8"
    >
      <span className="bg-muted text-muted-foreground flex size-10 items-center justify-center rounded-xl">
        <Lock className="size-4" strokeWidth={1.75} aria-hidden="true" />
      </span>
      <div>
        <h1 id="no-access-h" className="display text-[2rem] leading-tight">
          You don&apos;t have access to this program
        </h1>
        <p className="text-soft mt-2 text-sm leading-relaxed">
          It belongs to another owner, or the link is wrong. Ask the owner to share the public audit
          page, or open one of your own programs.
        </p>
      </div>
      {programs.length ? (
        <ul className="grid w-full gap-1.5">
          {programs.slice(0, 6).map((p) => (
            <li key={p.id}>
              <Link
                href={`/app/programs/${p.id}`}
                className="hover:bg-muted/60 flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm font-medium"
              >
                {p.name}
                <ArrowRight className="text-muted-foreground size-3.5" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <Link href="/app">Your programs</Link>
        </Button>
        <Button asChild variant="ghost">
          <Link href="/c">Programs you joined</Link>
        </Button>
      </div>
    </section>
  );
}
