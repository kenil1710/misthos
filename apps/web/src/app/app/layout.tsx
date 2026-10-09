import Link from "next/link";
import { AppShell } from "@/components/app/app-shell";
import { Wordmark } from "@/components/brand/wordmark";
import { ThemeToggle } from "@/components/theme-toggle";
import { OwnerSignIn } from "@/components/web3/islands";
import { isFounder } from "@/lib/server/founders";
import { appOrigin } from "@/lib/server/env";
import { programSummaries } from "@/lib/server/program-summary";
import { shareOnXUrl } from "@/lib/share";
import { roundPill } from "@/lib/status-line";
import { getContributorSession, getOwnerSession } from "@/lib/server/session";

export const metadata = { title: { default: "App", template: "%s · Misthos" } };

export default async function AppLayout({ children }: LayoutProps<"/app">) {
  const [session, contributorOnly] = await Promise.all([
    getOwnerSession(),
    getContributorSession(),
  ]);
  if (!session)
    return (
      <>
        <div className="flex min-h-dvh flex-col">
          <header className="flex h-14 items-center justify-between px-4 sm:px-6">
            <Link href="/" aria-label="Misthos home" className="rounded-md">
              <Wordmark />
            </Link>
            <ThemeToggle />
          </header>
          <main
            id="main"
            className="mx-auto grid w-full max-w-[1080px] flex-1 content-start items-start gap-10 px-4 pt-[6vh] pb-16 sm:px-6 lg:grid-cols-[minmax(0,1fr)_26rem] lg:gap-16 lg:pt-[10vh]"
          >
            <section className="order-2 lg:order-1" aria-labelledby="owner-pitch">
              <p className="text-brand text-sm font-medium">For projects and teams</p>
              <h2
                id="owner-pitch"
                className="display mt-2 text-[2.25rem] leading-[1.05] sm:text-[2.75rem]"
              >
                <span className="block">Launch a campaign.</span>
                <span className="block">
                  AI pays your community for <em>real</em> work.
                </span>
              </h2>
              <ul className="text-soft mt-6 grid gap-3 text-[15px] leading-relaxed">
                {[
                  "Fund a USDC vault and set the rules: what counts, what it pays, the limits.",
                  "An AI agent checks every thread, article or pull request, scores it and explains why.",
                  "Good work is paid automatically from your vault, never above its limits.",
                ].map((t) => (
                  <li key={t} className="flex gap-3">
                    <span className="bg-brand mt-2.5 size-1.5 shrink-0 rounded-full" aria-hidden />
                    {t}
                  </li>
                ))}
              </ul>
              <DecisionPreview />
            </section>
            <div className="order-1 grid gap-4 lg:order-2">
              <section className="bg-card shadow-soft rounded-2xl border p-6 sm:p-8">
                <h1 className="text-xl font-medium tracking-tight">Sign in to Misthos</h1>
                <p className="text-muted-foreground mt-1.5 mb-7 text-sm leading-relaxed">
                  With the wallet that owns your campaigns. Nothing opens until you click.
                </p>
                <OwnerSignIn />
              </section>
              {contributorOnly ? (
                <section
                  aria-label="Signed in as a contributor"
                  className="bg-card/60 rounded-xl p-5 text-sm"
                >
                  <p>
                    You&apos;re signed in with X as{" "}
                    <span className="font-medium">@{contributorOnly.xh}</span>.
                  </p>
                  <Link
                    href="/c"
                    className="text-brand mt-2 inline-block font-medium underline-offset-4 hover:underline"
                  >
                    Go to the programs you joined
                  </Link>
                </section>
              ) : (
                <p className="text-muted-foreground px-1 text-sm leading-relaxed">
                  Posting for a campaign? Open its join link and sign in with X.
                </p>
              )}
            </div>
          </main>
        </div>
      </>
    );

  const [summaries, founder, contributor] = await Promise.all([
    programSummaries(session.sub),
    isFounder(session),
    Promise.resolve(contributorOnly),
  ]);
  const origin = appOrigin();
  return (
    <AppShell
      address={session.addr}
      founder={founder}
      contributor={!!contributor}
      programs={summaries.map(({ program: p, waitingReview, needs, round }) => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        status: p.status,
        review: waitingReview,
        roundPill: p.status === "draft" ? null : roundPill(round),
        needs: needs.map(({ text, href, action, kind }) => ({ text, href, action, kind })),
        joinUrl: `${origin}/join/${p.slug}`,
        shareHref: shareOnXUrl({
          name: p.name,
          joinUrl: `${origin}/join/${p.slug}`,
          sources: [...new Set(p.rubricJson.categories.flatMap((c) => c.sourceTypes))],
          bestPayout: p.rubricJson.categories.reduce(
            (m, c) =>
              p.ratePerPoint * BigInt(c.maxPoints) > m ? p.ratePerPoint * BigInt(c.maxPoints) : m,
            0n,
          ),
        }),
      }))}
    >
      {children}
    </AppShell>
  );
}

/** A small, static picture of what the agent produces: a signed decision and the payout that followed. */
function DecisionPreview() {
  return (
    <figure
      aria-label="Example: a decision and its payout"
      className="bg-card shadow-soft mt-10 max-w-md rounded-2xl border p-5 text-sm"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium">@alice_builds · thread</span>
        <span className="bg-success-subtle text-success rounded-full px-2.5 py-0.5 text-xs font-medium">
          Approved
        </span>
      </div>
      <p className="text-soft mt-2 leading-relaxed">
        Explains how Arc quotes gas in USDC, with a working example. Depth 8/10, clarity 9/10.
      </p>
      <div className="text-muted-foreground mt-4 flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs">
        <span>
          Signed by the agent · <span className="font-mono">0x2f44…3bb6</span>
        </span>
        <span className="text-foreground font-medium tabular-nums">Paid 8.00 USDC</span>
      </div>
    </figure>
  );
}
