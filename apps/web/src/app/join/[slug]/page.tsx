import { decisions, getDb, submissions } from "@misthos/db";
import { formatUsdc, Slug } from "@misthos/shared";
import { listSources } from "@misthos/shared/sources";
import { and, desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SignOutButton } from "@/components/app/sign-out-button";
import { SiteHeader } from "@/components/app/site-header";
import { JoinWallet } from "@/components/contributor/wallet-islands";
import { PreviewBanner } from "@/components/app/preview-banner";
import { perfectLine } from "@/lib/program-math";
import { draftPreviewFor } from "@/lib/server/preview";
import { Button } from "@/components/ui/button";
import { getContributorMembership, getProgramBySlug, getRounds } from "@/lib/server/queries";
import { currentRound, isScheduled } from "@/lib/rounds";
import { getContributorSession } from "@/lib/server/session";
import { utcDay } from "@/lib/time";
import { fromNow } from "@/lib/when";
import { Stepper } from "@/components/ui-kit/stepper";

const X_ERRORS: Record<string, string> = {
  denied: "X sign-in was cancelled.",
  expired: "The sign-in took too long. Try again.",
  state_mismatch: "The sign-in couldn't be verified. Try again.",
  x_unavailable: "X didn't respond. Try again in a minute.",
};

/** The highest-paid approved decision in this program, as a concrete example of what good work looks like. */
async function bestDecision(programId: string) {
  const [d] = await getDb()
    .select({ summary: decisions.summary, amount: decisions.amount })
    .from(decisions)
    .innerJoin(submissions, eq(submissions.id, decisions.submissionId))
    .where(and(eq(submissions.programId, programId), eq(decisions.action, "approve")))
    .orderBy(desc(decisions.amount))
    .limit(1);
  return d ?? null;
}

async function load(slug: string) {
  const parsed = Slug.safeParse(slug);
  if (!parsed.success) return null;
  const program = await getProgramBySlug(parsed.data);
  // Drafts and archived programs don't have a public join page.
  return program && (program.status === "active" || program.status === "paused") ? program : null;
}

export async function generateMetadata({ params }: PageProps<"/join/[slug]">): Promise<Metadata> {
  const program = await load((await params).slug);
  return program ? { title: `Join ${program.name}`, description: program.description } : {};
}

export default async function JoinPage({ params, searchParams }: PageProps<"/join/[slug]">) {
  const { slug } = await params;
  const program = (await load(slug)) ?? (await draftPreviewFor(slug));
  if (!program) notFound();
  const preview = program.status !== "active" && program.status !== "paused";
  const sp = await searchParams;
  const xError = sp.x_error;
  // Sent here from a signed-out dashboard link: come back to the dashboard after signing in (it sends
  // non-members back here to join).
  const toDashboard = sp.return === "dashboard";
  const [session, rounds, example] = await Promise.all([
    getContributorSession(),
    getRounds(program.id),
    bestDecision(program.id),
  ]);
  const membership = session ? await getContributorMembership(program.id, session.xid) : null;
  const round = currentRound(rounds);
  const first = program.rubricJson.categories[0];

  const best = program.rubricJson.categories.reduce(
    (m, c) =>
      program.ratePerPoint * BigInt(c.maxPoints) > m
        ? program.ratePerPoint * BigInt(c.maxPoints)
        : m,
    0n,
  );
  const roundOpen = !!round && round.status === "open" && !isScheduled(round);

  return (
    <>
      {preview ? <PreviewBanner programId={program.id} what="join page" /> : null}
      <SiteHeader right={session ? <SignOutButton kind="contributor" /> : null} />
      <main
        id="main"
        className="mx-auto grid w-full max-w-6xl flex-1 content-start grid-cols-[minmax(0,1fr)] gap-12 px-4 py-8 sm:px-6 sm:py-14 lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-16"
      >
        <article className="min-w-0">
          <p className="text-brand text-sm font-medium">Contributor program</p>
          <h1 className="display mt-2 text-[2.75rem] leading-[1.02] [overflow-wrap:anywhere] sm:text-[4rem]">
            {program.name}
          </h1>
          <p className="text-soft mt-4 max-w-[60ch] text-[17px] leading-relaxed">
            {program.description}
          </p>
          <ul className="mt-6 flex flex-wrap gap-2 text-sm" aria-label="At a glance">
            {round ? (
              <li className="bg-card shadow-soft inline-flex items-center gap-2 rounded-full px-3.5 py-1.5">
                <span
                  aria-hidden="true"
                  className={`size-2 rounded-full ${roundOpen ? "bg-brand" : "bg-muted-foreground/50"}`}
                />
                {roundOpen
                  ? `Round ${round.number} is open, closes ${fromNow(round.endsAt)}`
                  : `Round ${round.number}: ${utcDay(round.startsAt)} to ${utcDay(round.endsAt)}`}
              </li>
            ) : null}
            <li className="bg-card shadow-soft rounded-full px-3.5 py-1.5">
              Up to <span className="mono-num font-medium">{formatUsdc(best)}</span> per piece
            </li>
            <li className="bg-card shadow-soft rounded-full px-3.5 py-1.5">Paid in USDC on Arc</li>
          </ul>

          <h2 className="display mt-14 text-[1.875rem] leading-tight">What it pays for</h2>
          <ul className="mt-5 grid gap-4 sm:grid-cols-2">
            {program.rubricJson.categories.map((c) => (
              <li
                key={c.key}
                className="bg-card shadow-soft grid content-start gap-3 rounded-[1.25rem] p-5 sm:p-6"
              >
                <div>
                  <p className="text-muted-foreground text-xs">up to</p>
                  <p className="display text-[2.25rem] leading-none tabular-nums">
                    {formatUsdc(program.ratePerPoint * BigInt(c.maxPoints), { withSymbol: false })}
                    <span className="text-muted-foreground ml-1 font-sans text-xs">USDC</span>
                  </p>
                </div>
                <div>
                  <p className="font-medium">{c.name}</p>
                  <p className="text-soft mt-1 text-sm leading-relaxed">{c.description}</p>
                </div>
                <p className="text-muted-foreground text-xs">
                  {listSources(c.sourceTypes)} · scored on{" "}
                  {c.criteria.map((k) => k.name.toLowerCase()).join(", ")}
                </p>
                {c.rules ? (
                  <p className="bg-muted/60 rounded-xl px-3 py-2 text-[13px] leading-relaxed">
                    {c.rules}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
          {program.rubricJson.generalRules ? (
            <>
              <h2 className="mt-12 text-base font-medium">Rules</h2>
              <p className="text-soft mt-2 text-sm leading-relaxed whitespace-pre-line">
                {program.rubricJson.generalRules}
              </p>
            </>
          ) : null}

          <h2 className="display mt-14 text-[1.875rem] leading-tight">How it works</h2>
          <Stepper
            className="mt-6"
            orientation="responsive"
            label="How it works"
            steps={[
              [
                "Join",
                "Sign in with X and link the wallet you want to be paid in. Free, about a minute.",
              ],
              [
                "Do the work",
                "Post, write or ship something this program pays for, from your own accounts.",
              ],
              [
                "Submit the link",
                "An AI agent checks it's yours, original and inside the round, scores it and tells you why.",
              ],
              [
                "Get paid",
                "Approved work is paid in USDC on Arc when the round closes. Every payout is public.",
              ],
            ].map(([t, d], i) => ({
              key: t!,
              label: t,
              status: i === 0 ? (membership ? "done" : "current") : "waiting",
              detail: d,
            }))}
          />

          <h2 className="display mt-14 text-[1.875rem] leading-tight">An example of good work</h2>
          {example ? (
            <figure className="bg-card shadow-soft mt-5 rounded-[1.25rem] p-6 text-sm">
              <blockquote className="text-[15px] leading-relaxed">{example.summary}</blockquote>
              <figcaption className="text-muted-foreground mt-3 text-xs">
                A real decision from this program, paid {formatUsdc(example.amount)}.{" "}
                <a
                  href={`/p/${program.slug}`}
                  className="text-foreground underline underline-offset-4"
                >
                  See every decision
                </a>
              </figcaption>
            </figure>
          ) : (
            <div className="bg-card shadow-soft mt-5 rounded-[1.25rem] p-6 text-sm">
              <p className="font-medium">
                {perfectLine(
                  first?.name ?? "",
                  formatUsdc(program.ratePerPoint * BigInt(first?.maxPoints ?? 0)),
                )}{" "}
                when it scores 10 on:
              </p>
              <ul className="text-soft mt-2 grid list-disc gap-1 pl-5">
                {(program.rubricJson.categories[0]?.criteria ?? []).map((k) => (
                  <li key={k.key}>
                    <span className="text-foreground">{k.name}:</span> {k.description}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-muted-foreground mt-8 max-w-[62ch] text-sm leading-relaxed">
            Payouts come from a vault with limits enforced on-chain, and every decision is published
            on the program&apos;s{" "}
            <a href={`/p/${program.slug}`} className="text-foreground underline underline-offset-4">
              audit page
            </a>
            .
          </p>
        </article>

        <aside className="bg-card shadow-lift order-first h-fit rounded-[1.5rem] p-6 sm:p-7 lg:sticky lg:top-6 lg:order-none">
          {preview ? (
            <>
              <h2 className="display text-[1.75rem] leading-tight">Join</h2>
              <p className="text-muted-foreground mt-2 text-sm">
                Contributors can join here once you publish the program.
              </p>
            </>
          ) : program.status === "paused" && !membership ? (
            <>
              <h2 className="display text-[1.75rem] leading-tight">Joining is paused</h2>
              <p className="text-soft mt-2 text-sm">
                This program isn&apos;t accepting new contributors right now.
              </p>
            </>
          ) : membership ? (
            <div className="grid gap-4">
              <h2 className="display text-[1.75rem] leading-tight">
                You&apos;re <em>in</em>
              </h2>
              <p className="text-soft text-sm">Joined as @{membership.xHandle}.</p>
              <Button asChild size="lg" className="h-11 text-[15px]">
                <Link href={`/c/${program.slug}`}>Go to your dashboard</Link>
              </Button>
            </div>
          ) : (
            <div className="grid gap-5">
              <div>
                <h2 className="display text-[1.75rem] leading-tight">Join in two steps</h2>
                <p className="text-muted-foreground mt-1 text-sm">Free, about a minute.</p>
              </div>
              <Stepper
                label="Join steps"
                steps={[
                  {
                    key: "x",
                    label: session ? `Signed in as @${session.xh}` : "Sign in with X",
                    status: session ? "done" : "current",
                    detail: session ? undefined : (
                      <span className="grid gap-3">
                        <span>
                          So the agent can confirm which posts are yours. Misthos reads your public
                          profile once and never posts.
                        </span>
                        <Button asChild className="w-full">
                          <a
                            href={`/api/auth/x/start?next=${encodeURIComponent(toDashboard ? `/c/${program.slug}` : `/join/${program.slug}`)}`}
                          >
                            Sign in with X
                          </a>
                        </Button>
                        {typeof xError === "string" && X_ERRORS[xError] ? (
                          <span role="alert" className="text-danger text-sm">
                            {X_ERRORS[xError]}
                          </span>
                        ) : null}
                      </span>
                    ),
                  },
                  {
                    key: "wallet",
                    label: "Link your payout wallet",
                    status: session ? "current" : "waiting",
                    detail: session ? (
                      <span className="grid gap-3">
                        <span>
                          USDC is paid to this wallet on Arc. Signing proves it&apos;s yours; it
                          costs nothing.
                        </span>
                        <JoinWallet programSlug={program.slug} />
                      </span>
                    ) : (
                      "USDC is paid to this wallet on Arc."
                    ),
                  },
                ]}
              />
            </div>
          )}
        </aside>
      </main>
    </>
  );
}
