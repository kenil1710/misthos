import Link from "next/link";
import { Mark, Wordmark } from "@/components/brand/wordmark";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { explorerAddress, factoryAddress } from "@/lib/landing-links";
import { AccountNav } from "./account-nav";

export function SiteHeader() {
  return (
    <header className="bg-background/80 supports-[backdrop-filter]:bg-background/70 sticky top-0 z-40 supports-[backdrop-filter]:backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-[1240px] items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" aria-label="Misthos home" className="rounded-md">
          <Wordmark />
        </Link>
        <nav aria-label="Main" className="flex items-center gap-1">
          <div className="hidden items-center gap-1 md:flex">
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
    <footer className="bg-card mt-32 rounded-t-[2rem] md:mt-40">
      <div className="mx-auto grid max-w-[1240px] gap-12 px-4 pt-16 pb-10 sm:px-6 md:grid-cols-12 md:pt-20">
        <div className="md:col-span-5">
          <Wordmark />
          <p className="text-soft mt-4 max-w-xs leading-relaxed">
            Launch a campaign. AI pays your community for real work. Live on Arc testnet with test
            USDC.
          </p>
          <Button asChild className="mt-6">
            <Link href="/app" prefetch={false}>
              Launch a campaign
            </Link>
          </Button>
        </div>
        <nav
          aria-label="Footer"
          className="grid grid-cols-2 gap-8 text-sm sm:grid-cols-3 md:col-span-7"
        >
          <FooterGroup title="Product">
            <Link href="/app" prefetch={false}>
              Open the app
            </Link>
            <a href="#how-it-works">How it works</a>
            <a href="#guardrails">Guardrails</a>
            <a href="#faq">Questions</a>
          </FooterGroup>
          <FooterGroup title="Docs">
            <Link href="/docs">Introduction</Link>
            <Link href="/docs/quickstart">Quickstart</Link>
            <Link href="/docs/how-the-agent-decides">How the agent decides</Link>
            <Link href="/docs/security">Security</Link>
          </FooterGroup>
          <FooterGroup title="On-chain">
            <a href={explorerAddress(factoryAddress)} target="_blank" rel="noreferrer">
              Vault factory
            </a>
            <Link href="/docs/guardrails#deployed-contracts">Contract addresses</Link>
            <Link href="/docs/audit-trail">Audit trail</Link>
          </FooterGroup>
        </nav>
      </div>
      <div className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-3 border-t px-4 py-6 text-xs sm:px-6">
        <span className="text-muted-foreground inline-flex items-center gap-2">
          <Mark className="text-brand size-4" />
          Misthos pays in USDC on Arc. You keep the keys and the funds.
        </span>
        <span className="text-muted-foreground">Arc testnet · test USDC only</span>
      </div>
    </footer>
  );
}

function FooterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="font-medium">{title}</p>
      <div className="text-muted-foreground [&_a:hover]:text-foreground mt-4 flex flex-col gap-2.5 [&_a]:w-fit [&_a]:rounded-sm [&_a]:transition-colors">
        {children}
      </div>
    </div>
  );
}
