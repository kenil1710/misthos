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
            className="flex flex-1 flex-col items-center justify-start px-4 pt-[8vh] pb-16"
          >
            <section className="bg-card w-full max-w-[26rem] rounded-xl border p-6 sm:p-8">
              <h1 className="text-xl font-medium tracking-tight">Sign in to Misthos</h1>
              <p className="text-muted-foreground mt-1.5 mb-7 text-sm leading-relaxed">
                Run contributor programs: the agent reviews submitted work and pays it from a vault
                you own.
              </p>
              <OwnerSignIn />
            </section>
            {contributorOnly ? (
              <section
                aria-label="Signed in as a contributor"
                className="bg-card/60 mt-4 w-full max-w-[26rem] rounded-xl p-5 text-sm"
              >
                <p>
                  You&apos;re signed in with X as{" "}
                  <span className="font-medium">@{contributorOnly.xh}</span>. This is the app for
                  program owners; your contributions are on your own page.
                </p>
                <Link
                  href="/c"
                  className="text-brand mt-2 inline-block font-medium underline-offset-4 hover:underline"
                >
                  Go to the programs you joined
                </Link>
              </section>
            ) : null}
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
