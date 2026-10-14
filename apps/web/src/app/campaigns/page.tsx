import { formatUsdc } from "@misthos/shared/money";
import type { ChainKey } from "@misthos/shared/chains";
import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { Address } from "viem";
import { OwnerAppShell } from "@/components/app/owner-app-shell";
import { SiteHeader } from "@/components/app/site-header";
import { ContributorAccount } from "@/components/contributor/contributor-account";
import { NetworkBadge } from "@/components/network-badge";
import { SwitchNetworkButton } from "@/components/network-empty";
import { Button } from "@/components/ui/button";
import { budgetOf } from "@/lib/budget";
import { stillOpen } from "@/lib/explore";
import { openCampaignsCached, type OpenCampaign } from "@/lib/server/explore";
import { selectedNetwork } from "@/lib/server/network";
import { readVaultForPage } from "@/lib/server/vault";
import { getContributorSession, getOwnerSession } from "@/lib/server/session";
import { fromNow } from "@/lib/when";

export const metadata: Metadata = {
  title: "Explore campaigns",
  description: "Open Misthos campaigns you can join now: get paid in USDC on Arc for real work.",
  alternates: { canonical: "/campaigns" },
};

const NAME: Record<ChainKey, string> = {
  "arc-testnet": "Arc Testnet",
  "arc-mainnet": "Arc Mainnet",
};

/** Every campaign open to new contributors on the header's network, with a way in. */
export default async function ExploreCampaigns() {
  const [network, owner, contributor] = await Promise.all([
    selectedNetwork(),
    getOwnerSession(),
    getContributorSession(),
  ]);
  const other: ChainKey = network === "arc-mainnet" ? "arc-testnet" : "arc-mainnet";
  const [all, otherList] = await Promise.all([
    openCampaignsCached(network).then((l) => stillOpen(l)),
    openCampaignsCached(other).then((l) => stillOpen(l)),
  ]);
  // Balance only: the vault's owner and agent addresses aren't shown here. A campaign whose budget is used up is
  // hidden until the owner adds funds (an unreadable balance doesn't hide it).
  const read = await Promise.all(
    all.map(async (c) => {
      const balance = await readVaultForPage(c.vaultAddress as Address, c.chain).then(
        (v) => v?.balance ?? null,
      );
      return { c, balance, budget: budgetOf({ balance, ...c }) };
    }),
  );
  const shown = read.filter((x) => !x.budget.usedUp);
  const list = shown.map((x) => x.c);
  const balances = shown.map((x) => x.balance);

  const body = (
    <div className="grid content-start gap-10">
      <div>
        <h1 className="display text-[2.5rem] leading-[1.05] sm:text-[3.25rem]">
          Explore <em>campaigns</em>
        </h1>
        <p className="text-soft mt-2 max-w-[60ch] text-[15px]">
          Campaigns on {NAME[network]} with a round open now. Join, do the work, and get paid in{" "}
          {network === "arc-mainnet" ? "real" : "test"} USDC when the round closes.
        </p>
      </div>
      {list.length === 0 ? (
        <div
          className="bg-card/50 grid justify-items-center gap-1.5 rounded-[1.25rem] border border-dashed px-6 py-12 text-center"
          data-testid="explore-empty"
        >
          <p className="display text-[1.5rem] leading-tight">
            No open campaigns on {NAME[network]} yet
          </p>
          <p className="text-soft max-w-[46ch] text-sm leading-relaxed">
            Check back soon, or start one yourself.
            {otherList.length ? ` ${otherList.length} open on ${NAME[other]}.` : ""}
          </p>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {otherList.length ? (
              <SwitchNetworkButton to={other}>Show {NAME[other]}</SwitchNetworkButton>
            ) : null}
            <Button asChild size="sm" variant={otherList.length ? "ghost" : "default"}>
              <Link href="/app" prefetch={false}>
                Launch a campaign
              </Link>
            </Button>
          </div>
        </div>
      ) : (
        <ul
          aria-label={`Open campaigns on ${NAME[network]}`}
          className="grid items-stretch gap-5 sm:grid-cols-2 lg:grid-cols-3"
        >
          {list.map((c, i) => (
            <CampaignCard key={c.slug} c={c} balance={balances[i] ?? null} />
          ))}
        </ul>
      )}
    </div>
  );

  // Signed in with a wallet: inside the app, sidebar and all. Signed in with X only: the contributor header (like
  // "Programs you joined"). Signed out: the public page.
  if (owner)
    return (
      <OwnerAppShell session={owner} contributor={!!contributor}>
        <div className="pt-4 pb-4">{body}</div>
      </OwnerAppShell>
    );
  return (
    <>
      <SiteHeader
        right={
          contributor ? (
            <>
              <Button asChild variant="ghost" size="sm">
                <Link href="/c">Programs you joined</Link>
              </Button>
              <ContributorAccount handle={contributor.xh} />
            </>
          ) : null
        }
      />
      <main
        id="main"
        className="mx-auto grid w-full max-w-6xl flex-1 content-start px-4 py-8 sm:px-6 sm:py-12"
      >
        {body}
      </main>
    </>
  );
}

function CampaignCard({ c, balance }: { c: OpenCampaign; balance: bigint | null }) {
  return (
    <li
      className="bg-card shadow-soft flex flex-col rounded-[1.5rem] p-6"
      data-testid="campaign-card"
    >
      <NetworkBadge chain={c.chain} short className="mb-3 self-start" />
      <h2 className="display text-[1.625rem] leading-tight [overflow-wrap:anywhere]">{c.name}</h2>
      <p className="text-soft mt-2 line-clamp-3 text-sm leading-relaxed">{c.description}</p>
      <div className="mt-5">
        <p className="text-muted-foreground text-xs">Pays for {c.paysFor.join(", ")}</p>
        <p className="display mt-1 text-[2rem] leading-none tabular-nums">
          <span className="text-muted-foreground mr-1.5 font-sans text-xs">up to</span>
          {formatUsdc(c.maxPerPiece, { withSymbol: false })}
          <span className="text-muted-foreground ml-1 font-sans text-xs">USDC</span>
        </p>
      </div>
      <dl className="mt-5 grid grid-cols-3 gap-x-3 border-t pt-4 text-sm">
        <div>
          <dt className="text-muted-foreground text-xs">Round {c.round.number} closes</dt>
          <dd className="mt-0.5">{fromNow(c.round.endsAt)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">Vault</dt>
          <dd className="mono-num mt-0.5">
            {balance === null ? (
              <span className="text-muted-foreground">Unavailable</span>
            ) : (
              formatUsdc(balance)
            )}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">Contributors</dt>
          <dd className="mono-num mt-0.5">{c.contributors}</dd>
        </div>
      </dl>
      <div className="mt-auto flex items-center justify-between gap-3 pt-6">
        <Link
          href={`/p/${c.slug}`}
          className="text-muted-foreground hover:text-foreground text-sm underline-offset-4 hover:underline"
        >
          Audit page
        </Link>
        <Button asChild size="sm">
          <Link href={`/join/${c.slug}`} aria-label={`Join ${c.name}`}>
            Join
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </Link>
        </Button>
      </div>
    </li>
  );
}
