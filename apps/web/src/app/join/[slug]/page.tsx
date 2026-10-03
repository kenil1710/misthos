import { decisions, getDb, submissions } from "@misthos/db";
import { formatUsdc, Slug } from "@misthos/shared";
import { listSources } from "@misthos/shared/sources";
import { and, desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { Check } from "lucide-react";
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
import { currentRound } from "@/lib/rounds";
import { getContributorSession } from "@/lib/server/session";
import { utcDay } from "@/lib/time";

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

function JoinStep({
  n,
  title,
  done,
  current,
  children,
}: {
  n: number;
  title: string;
  done: boolean;
  current: boolean;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span
        className={`flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium tabular-nums ${done ? "bg-foreground border-foreground text-background" : current ? "border-foreground" : "text-muted-foreground"}`}
        aria-hidden="true"
      >
        {done ? <Check className="size-3.5" strokeWidth={2.5} /> : n}
      </span>
      <div className="grid min-w-0 flex-1 gap-3">
        <p className={`leading-6 font-medium ${!done && !current ? "text-muted-foreground" : ""}`}>
          {title}
          <span className="sr-only">{done ? " (done)" : current ? " (current step)" : ""}</span>
        </p>
        {current ? children : null}
      </div>
    </li>
  );
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

  return (
    <>
      {preview ? <PreviewBanner programId={program.id} what="join page" /> : null}
      <SiteHeader right={session ? <SignOutButton kind="contributor" /> : null} />
      <main
        id="main"
        className="mx-auto grid w-full max-w-5xl flex-1 grid-cols-[minmax(0,1fr)] gap-10 px-4 py-8 sm:px-6 sm:py-12 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-12"
      >
        <article>
          <p className="text-muted-foreground text-sm">Contributor program</p>
          <h1 className="mt-1 text-3xl font-medium tracking-[-0.02em]">{program.name}</h1>
          <p className="text-muted-foreground mt-3 max-w-2xl">{program.description}</p>

          <h2 className="mt-10 text-base font-medium">What this program pays for</h2>
          <ul className="mt-3 grid gap-3">
            {program.rubricJson.categories.map((c) => (
              <li key={c.key} className="bg-card rounded-xl border p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">{c.name}</span>
                  <span className="font-mono text-sm tabular-nums">
                    up to {formatUsdc(program.ratePerPoint * BigInt(c.maxPoints))}
                  </span>
                </div>
                <p className="text-muted-foreground mt-1 text-sm">{c.description}</p>
                <p className="text-muted-foreground mt-2 text-xs">
                  {listSources(c.sourceTypes)} · scored on{" "}
                  {c.criteria.map((k) => k.name.toLowerCase()).join(", ")}
                </p>
                {c.rules ? <p className="mt-2 text-sm">{c.rules}</p> : null}
              </li>
            ))}
          </ul>
          {program.rubricJson.generalRules ? (
            <>
              <h2 className="mt-10 text-base font-medium">Rules</h2>
              <p className="mt-2 text-sm whitespace-pre-line">{program.rubricJson.generalRules}</p>
            </>
          ) : null}
          <h2 className="mt-10 text-base font-medium">How it works</h2>
          <ol className="mt-4 grid gap-4 sm:grid-cols-2">
            {[
              [
                "Join",
                "Sign in with X and link the wallet you want to be paid in. It takes a minute and costs nothing.",
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
            ].map(([t, d], i) => (
              <li key={t} className="flex gap-3">
                <span className="text-muted-foreground mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-xs tabular-nums">
                  {i + 1}
                </span>
                <span className="text-sm">
                  <span className="block font-medium">{t}</span>
                  <span className="text-soft">{d}</span>
                </span>
              </li>
            ))}
          </ol>
          <h2 className="mt-10 text-base font-medium">An example of good work</h2>
          {example ? (
            <figure className="bg-card mt-3 rounded-xl border p-4 text-sm">
              <blockquote className="leading-relaxed">{example.summary}</blockquote>
              <figcaption className="text-muted-foreground mt-2 text-xs">
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
            <div className="bg-card mt-3 rounded-xl border p-4 text-sm">
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
          <p className="text-muted-foreground mt-6 text-sm">
            Payouts come from a vault with limits enforced on-chain, and every decision is published
            on the program&apos;s{" "}
            <a href={`/p/${program.slug}`} className="text-foreground underline underline-offset-4">
              audit page
            </a>
            .
          </p>
        </article>

        <aside className="bg-card order-first h-fit rounded-xl border p-5 sm:p-6 lg:sticky lg:top-6 lg:order-none">
          {round ? (
            <p className="text-muted-foreground text-sm">
              Round {round.number}: {utcDay(round.startsAt)} to {utcDay(round.endsAt)} (UTC)
            </p>
          ) : null}
          {preview ? (
            <p className="text-muted-foreground mt-3 text-sm">
              Contributors can join here once you publish the program.
            </p>
          ) : program.status === "paused" && !membership ? (
            <p className="mt-3 text-sm">
              This program isn&apos;t accepting new contributors right now.
            </p>
          ) : membership ? (
            <div className="mt-3 grid gap-3">
              <p className="text-sm">You&apos;re in as @{membership.xHandle}.</p>
              <Button asChild>
                <Link href={`/c/${program.slug}`}>Go to your dashboard</Link>
              </Button>
            </div>
          ) : (
            <div className="mt-4 grid gap-5">
              <h2 className="font-medium">Join in two steps</h2>
              <ol className="grid gap-5">
                <JoinStep n={1} title="Sign in with X" done={!!session} current={!session}>
                  <p className="text-muted-foreground text-sm">
                    So the agent can confirm which posts are yours. Misthos reads your public
                    profile once and never posts.
                  </p>
                  <Button asChild className="w-full">
                    <a
                      href={`/api/auth/x/start?next=${encodeURIComponent(toDashboard ? `/c/${program.slug}` : `/join/${program.slug}`)}`}
                    >
                      Sign in with X
                    </a>
                  </Button>
                  {typeof xError === "string" && X_ERRORS[xError] ? (
                    <p role="alert" className="text-danger text-sm">
                      {X_ERRORS[xError]}
                    </p>
                  ) : null}
                </JoinStep>
                <JoinStep n={2} title="Link your payout wallet" done={false} current={!!session}>
                  {session ? (
                    <>
                      <p className="text-muted-foreground text-sm">
                        Signed in as{" "}
                        <span className="text-foreground font-medium">@{session.xh}</span>. USDC is
                        paid to this wallet on Arc.
                      </p>
                      <JoinWallet programSlug={program.slug} />
                    </>
                  ) : null}
                </JoinStep>
              </ol>
            </div>
          )}
        </aside>
      </main>
    </>
  );
}
