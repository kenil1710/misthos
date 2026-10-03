import Link from "next/link";
import { Wordmark } from "@/components/brand/wordmark";
import { ThemeToggle } from "@/components/theme-toggle";
import { AccountNav } from "./account-nav";
import { Button } from "@/components/ui/button";
import { explorerAddress, factoryAddress } from "@/lib/landing-links";

export function SiteHeader() {
  return (
    <header className="bg-background/95 sticky top-0 z-40 border-b supports-[backdrop-filter]:bg-background/85 supports-[backdrop-filter]:backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-[1200px] items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" aria-label="Misthos home" className="rounded-md">
          <Wordmark />
        </Link>
        <nav aria-label="Main" className="flex items-center gap-1">
          <div className="hidden items-center gap-1 sm:flex">
            <Button asChild variant="ghost" size="sm" className="text-soft">
              <a href="#how-it-works">How it works</a>
            </Button>
            <Button asChild variant="ghost" size="sm" className="text-soft">
              <a href="#guardrails">Guardrails</a>
            </Button>
            <Button asChild variant="ghost" size="sm" className="text-soft">
              <Link href="/docs">Docs</Link>
            </Button>
          </div>
          <ThemeToggle />
          <AccountNav />
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t">
      <div className="mx-auto grid max-w-[1200px] gap-8 px-4 py-12 sm:px-6 md:grid-cols-12">
        <div className="md:col-span-5">
          <Wordmark />
          <p className="text-muted-foreground mt-3 max-w-sm text-sm leading-relaxed">
            Contributor payroll on Arc. Running on Arc testnet with test USDC.
          </p>
        </div>
        <nav
          aria-label="Footer"
          className="grid grid-cols-2 gap-8 text-sm sm:grid-cols-3 md:col-span-7"
        >
          <FooterGroup title="Product">
            <Link href="/app" prefetch={false}>
              Open app
            </Link>
            <a href="#how-it-works">How it works</a>
            <a href="#faq">FAQ</a>
          </FooterGroup>
          <FooterGroup title="Docs">
            <Link href="/docs">Introduction</Link>
            <Link href="/docs/how-the-agent-decides">How the agent decides</Link>
            <Link href="/docs/security">Security</Link>
          </FooterGroup>
          <FooterGroup title="On-chain">
            <a href={explorerAddress(factoryAddress)} target="_blank" rel="noreferrer">
              Vault factory
            </a>
            <Link href="/docs/guardrails">Contract addresses</Link>
          </FooterGroup>
        </nav>
      </div>
    </footer>
  );
}

function FooterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="font-medium">{title}</p>
      <div className="text-muted-foreground [&_a:hover]:text-foreground mt-3 flex flex-col gap-2 [&_a]:w-fit [&_a]:rounded-sm [&_a]:transition-colors">
        {children}
      </div>
    </div>
  );
}
