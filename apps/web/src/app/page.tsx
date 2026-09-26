import Link from "next/link";
import { Wordmark } from "@/components/brand/wordmark";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";

// Phase 0 shell. The full landing page (§9) is built in Phase 6.
export default function Home() {
  return (
    <>
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/" aria-label="Misthos home" className="rounded-md">
            <Wordmark />
          </Link>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <Button size="sm" disabled>
              Launch app
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center px-4 py-24 sm:px-6">
        <h1 className="max-w-3xl text-4xl font-semibold sm:text-5xl">
          Contributor payroll, run by an agent you can audit.
        </h1>
        <p className="text-muted-foreground mt-4 max-w-xl text-base">
          Misthos verifies contributor work, catches fraud, and pays in USDC on Arc, inside limits
          enforced on-chain.
        </p>
        <p className="text-muted-foreground mt-10 text-sm">In development.</p>
      </main>
    </>
  );
}
