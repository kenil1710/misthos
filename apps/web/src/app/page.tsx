import { formatUsdc, shortHex } from "@misthos/shared";
import { SOURCE_LABEL, type SourceType } from "@misthos/shared/sources";
import { ArrowUpRight, Check } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import heroDark from "@/assets/landing/hero-dark.png";
import heroLight from "@/assets/landing/hero-light.png";
import verifyDark from "@/assets/landing/verify-dark.png";
import verifyLight from "@/assets/landing/verify-light.png";
import { CountUp } from "@/components/landing/count-up";
import { ProductFrame } from "@/components/landing/product-frame";
import { Reveal } from "@/components/landing/reveal";
import { SiteFooter, SiteHeader } from "@/components/landing/site-chrome";
import { ActionBadge } from "@/components/public/action-badge";
import { Button } from "@/components/ui/button";
import { explorerAddress } from "@/lib/landing-links";
import { type Example, landingData } from "@/lib/server/landing";
import { cn } from "@/lib/utils";

// Live numbers and examples, refreshed every five minutes.
export const revalidate = 300;

export const metadata: Metadata = {
  title: { absolute: "Misthos: contributor payroll, run by an agent you can audit" },
  alternates: { canonical: "/" },
};


export default async function Home() {
  const { metrics, showMetrics, featured, examples } = await landingData();
  const auditHref = featured ? `/p/${featured.slug}` : null;
  const verifyHref = featured
    ? `/p/${featured.slug}#verify${examples.approved ? `?d=${examples.approved.hash}` : ""}`
    : null;

  return (
    <>
      <SiteHeader />
      <main id="main" className="flex-1">
        {/* Hero */}
        <section className="mx-auto max-w-[1200px] px-4 pt-20 sm:px-6 md:pt-28">
          <div className="mx-auto max-w-[880px] text-center">
            <h1 className="text-[40px] leading-[1.05] font-medium tracking-[-0.03em] text-balance sm:text-[56px] lg:text-[68px]">
              Contributor payroll, run by an agent you can audit.
            </h1>
            <p className="text-soft mx-auto mt-6 max-w-[38rem] text-[17px] leading-relaxed sm:text-lg">
              Misthos checks every link your contributors submit, scores it against your rubric, and
              pays in USDC on Arc. Payouts stay inside limits your vault enforces on-chain, and
              every decision is signed so anyone can check it.
            </p>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button asChild size="lg" className="h-10 w-full px-4 text-[15px] sm:w-auto">
                <Link href="/app" prefetch={false}>
                  Start a program
                </Link>
              </Button>
              {auditHref ? (
                <Button
                  asChild
                  variant="outline"
                  size="lg"
                  className="h-10 w-full px-4 text-[15px] sm:w-auto"
                >
                  <Link href={auditHref} prefetch={false}>
                    View a live audit page
                  </Link>
                </Button>
              ) : null}
            </div>
            <p className="text-muted-foreground mt-5 text-sm">
              Live on Arc testnet with test USDC.
            </p>
          </div>
          <div className="mt-16 md:mt-20">
            <ProductFrame
              light={heroLight}
              dark={heroDark}
              priority
              mobileCrop
              sizes="(min-width: 1248px) 1200px, (min-width: 768px) 100vw, 820px"
              alt="The owner's review queue: the agent escalated a post that tried to instruct the grader, with its reasons and a recommended amount."
            />
          </div>
        </section>

        {/* Live metrics: real, non-demo programs only, and hidden until there is something to show. */}
        {showMetrics && metrics ? (
          <section aria-label="Live numbers" className="mx-auto mt-24 max-w-[1200px] px-4 sm:px-6">
            <dl className="grid grid-cols-2 gap-y-8 border-y py-8 md:grid-cols-4">
              <Metric label="USDC paid to contributors">
                <CountUp
                  value={Number(metrics.usdcPaidTestnet + metrics.usdcPaidMainnet) / 1e6}
                  decimals={2}
                />
              </Metric>
              <Metric label="Submissions reviewed">
                <CountUp value={metrics.submissionsReviewed} />
              </Metric>
              <Metric label="Contributors paid">
                <CountUp value={metrics.contributorsPaid} />
              </Metric>
              <Metric label="Rounds paid on Arc">
                <CountUp value={metrics.roundsExecuted} />
              </Metric>
            </dl>
          </section>
        ) : null}

        {/* Problem */}
        <Section>
          <Reveal>
            <SectionHeading title="Paying contributors by hand stops working at fifty people.">
              Ambassador and contributor programs pay for posts, pull requests and articles. Someone
              has to check every one, and that someone runs out of time.
            </SectionHeading>
          </Reveal>
          <div className="mt-14 grid gap-10 md:grid-cols-3 md:gap-8">
            {[
              [
                "Review doesn't scale",
                "Every link means opening it, checking who wrote it and when, and judging it against the brief. At a few hundred a week, checks get skipped.",
              ],
              [
                "Farming is cheap",
                "Copied threads, reposts, someone else's pull request, work from before the round. A program that doesn't check pays for all of it.",
              ],
              [
                "Payouts are a black box",
                "Contributors can't see why they got what they got. Sponsors can't see where the budget went or whether the rules held.",
              ],
            ].map(([title, body], i) => (
              <Reveal key={title} delay={i * 60}>
                <div className="border-t pt-6">
                  <h3 className="text-[17px] font-medium tracking-[-0.01em]">{title}</h3>
                  <p className="text-soft mt-2 leading-relaxed">{body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </Section>

        {/* How it works */}
        <Section id="how-it-works">
          <Reveal>
            <SectionHeading title="How it works">
              You set the rules and the limits once. The agent does the reviewing, and the vault
              does the paying.
            </SectionHeading>
          </Reveal>
          <ol className="mt-14 grid gap-px overflow-hidden rounded-xl border bg-[var(--border)] md:grid-cols-2 lg:grid-cols-4">
            {[
              [
                "Set the rules",
                "Write a rubric with points per category, set the rate, and deploy a vault from your wallet. Fund it with USDC.",
              ],
              [
                "Contributors submit links",
                "They sign in with X, prove their payout wallet with a signature, and paste links to posts, pull requests or articles.",
              ],
              [
                "The agent decides",
                "Code checks authorship, originality and timing. Claude scores the work against your rubric. Each decision is signed, with reasons. Unclear cases come to you.",
              ],
              [
                "Rounds pay out",
                "When a round closes, the agent proposes payouts. The vault checks each one against your limits and sends USDC.",
              ],
            ].map(([title, body], i) => (
              <li key={title} className="bg-card p-6 md:p-7">
                <span className="text-muted-foreground font-mono text-[13px] tabular-nums">
                  {i + 1}
                </span>
                <h3 className="mt-6 text-[17px] font-medium tracking-[-0.01em]">{title}</h3>
                <p className="text-soft mt-2 text-[15px] leading-relaxed">{body}</p>
              </li>
            ))}
          </ol>
        </Section>

        {/* Decisions */}
        {examples.approved || examples.rejected ? (
          <Section>
            <div className="grid gap-12 lg:grid-cols-12">
              <Reveal className="lg:col-span-4">
                <SectionHeading title="Every decision comes with its reasons.">
                  Approvals say what earned the points. Rejections say exactly what failed, in words
                  the contributor can act on. These two are real.
                </SectionHeading>
                {featured?.isDemo ? (
                  <p className="text-muted-foreground mt-4 text-sm leading-relaxed">
                    From the public demo program, decided and signed by the agent&apos;s wallet.
                  </p>
                ) : null}
              </Reveal>
              <div className="grid gap-4 lg:col-span-8">
                {[examples.approved, examples.rejected].map((e, i) =>
                  e && featured ? (
                    <Reveal key={e.hash} delay={i * 80}>
                      <DecisionCard example={e} slug={featured.slug} />
                    </Reveal>
                  ) : null,
                )}
              </div>
            </div>
          </Section>
        ) : null}

        {/* Guardrails */}
        <Section id="guardrails">
          <div className="grid gap-12 lg:grid-cols-12">
            <Reveal className="lg:col-span-5">
              <SectionHeading title="The agent decides. The contract sets the limits.">
                Payouts leave from a vault your wallet owns. The agent can register payout wallets
                and propose and execute rounds. Nothing else. The contract refuses any payout
                outside your limits, whatever the agent decided.
              </SectionHeading>
            </Reveal>
            <Reveal className="lg:col-span-7" delay={60}>
              <ul className="divide-y rounded-xl border">
                <Guardrail title="Caps per payout, per round and per 24 hours">
                  A payout over the cap reverts with{" "}
                  <code className="font-mono text-[13px]">PayoutTooLarge</code>.
                  {featured?.limits ? (
                    <>
                      {" "}
                      The demo vault allows {formatUsdc(BigInt(featured.limits.maxPerPayout))} per
                      contributor per round and {formatUsdc(BigInt(featured.limits.maxPerDay))} a
                      day.
                    </>
                  ) : null}
                </Guardrail>
                <Guardrail title="Your approval above a threshold">
                  Rounds above the amount you set wait for your signature before the agent can
                  execute them.
                </Guardrail>
                <Guardrail title="A cooldown on new payout wallets">
                  A wallet that was just added or changed can&apos;t be paid until the cooldown
                  ends, so a hijacked account can&apos;t redirect pay on the spot.
                </Guardrail>
                <Guardrail title="Pause and withdraw at any time">
                  You can pause the vault, change limits, replace the agent and withdraw, even while
                  paused.
                </Guardrail>
                <Guardrail title="Each payout once">
                  Every payout has a fixed id. The vault records it when paid and never pays it
                  again.
                </Guardrail>
              </ul>
              {featured?.vaultAddress ? (
                <a
                  href={explorerAddress(featured.vaultAddress)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-soft hover:text-foreground mt-4 inline-flex items-center gap-1 rounded-sm text-sm transition-colors"
                >
                  See the demo vault on the Arc explorer
                  <ArrowUpRight className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
                </a>
              ) : null}
            </Reveal>
          </div>
        </Section>

        {/* Audit trail */}
        <Section>
          <div className="grid items-start gap-12 lg:grid-cols-12">
            <Reveal className="lg:col-span-5">
              <SectionHeading title="Don't take the agent's word for it.">
                Each decision is a record hashed and signed by the agent&apos;s wallet. Each payout
                on Arc carries a hash of the records it pays for. The public audit page checks all
                of it in one click.
              </SectionHeading>
              <ol className="mt-8 space-y-4">
                {[
                  [
                    "Re-hash the record",
                    "The record is canonical JSON. Its keccak256 hash must match.",
                  ],
                  [
                    "Check the signature",
                    "Signed by the agent's Circle wallet, checked with ERC-1271 on Arc.",
                  ],
                  [
                    "Match the payment",
                    "The PayoutExecuted event on Arc must carry the same hash.",
                  ],
                ].map(([title, body]) => (
                  <li key={title} className="flex gap-3">
                    <Check
                      className="text-brand mt-1 size-4 shrink-0"
                      strokeWidth={1.5}
                      aria-hidden="true"
                    />
                    <div>
                      <p className="font-medium">{title}</p>
                      <p className="text-soft mt-0.5 text-[15px] leading-relaxed">{body}</p>
                    </div>
                  </li>
                ))}
              </ol>
              {verifyHref ? (
                <Button asChild variant="outline" size="lg" className="mt-8 h-10 px-4 text-[15px]">
                  <Link href={verifyHref} prefetch={false}>
                    Verify it yourself
                  </Link>
                </Button>
              ) : null}
            </Reveal>
            <Reveal className="lg:col-span-7" delay={60}>
              <ProductFrame
                light={verifyLight}
                dark={verifyDark}
                sizes="(min-width: 1024px) 680px, 100vw"
                alt="A decision verified on the public audit page: hash, signature and on-chain payout all match."
              />
            </Reveal>
          </div>
        </Section>

        {/* Built on */}
        <Section>
          <Reveal>
            <SectionHeading title="Built on Arc and Circle">
              Only what Misthos actually uses, and what for.
            </SectionHeading>
          </Reveal>
          <div className="mt-14 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
            {[
              [
                "USDC on Arc",
                "Payouts settle in USDC on Arc, which also charges gas in USDC. No second token to manage.",
              ],
              [
                "Circle Wallets",
                "The agent is a Circle developer-controlled smart-contract wallet. No raw agent key sits on a server.",
              ],
              [
                "Circle Gas Station",
                "Circle sponsors the agent wallet's gas, so the agent never needs to hold funds.",
              ],
              [
                "Contract execution",
                "Payout calls go through Circle with idempotency keys, so a retried job can't pay twice.",
              ],
            ].map(([title, body], i) => (
              <Reveal key={title} delay={i * 60}>
                <div className="border-t pt-6">
                  <h3 className="font-medium">{title}</h3>
                  <p className="text-soft mt-2 text-[15px] leading-relaxed">{body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </Section>

        {/* FAQ */}
        <Section id="faq">
          <div className="grid gap-12 lg:grid-cols-12">
            <div className="lg:col-span-4">
              <SectionHeading title="Questions" />
            </div>
            <div className="divide-y border-y lg:col-span-8">
              {FAQ.map(([q, a]) => (
                <details key={q} className="group py-1">
                  <summary className="hover:text-foreground flex cursor-pointer list-none items-center justify-between gap-6 rounded-sm py-4 text-[17px] font-medium [&::-webkit-details-marker]:hidden">
                    {q}
                    <span
                      aria-hidden="true"
                      className="text-muted-foreground text-xl leading-none font-normal transition-transform duration-200 group-open:rotate-45"
                    >
                      +
                    </span>
                  </summary>
                  <p className="text-soft max-w-[62ch] pb-5 leading-relaxed">{a}</p>
                </details>
              ))}
            </div>
          </div>
        </Section>

        {/* Final CTA */}
        <section className="border-t">
          <div className="mx-auto max-w-[1200px] px-4 py-28 text-center sm:px-6 md:py-36">
            <h2 className="mx-auto max-w-2xl text-[32px] leading-[1.1] font-medium tracking-[-0.025em] text-balance sm:text-[44px]">
              Run your next contributor round with Misthos.
            </h2>
            <p className="text-soft mx-auto mt-5 max-w-md leading-relaxed">
              Set up a program in a few minutes. You keep the keys and the funds.
            </p>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button asChild size="lg" className="h-10 w-full px-4 text-[15px] sm:w-auto">
                <Link href="/app" prefetch={false}>
                  Start a program
                </Link>
              </Button>
              <Button
                asChild
                variant="ghost"
                size="lg"
                className="h-10 w-full px-4 text-[15px] sm:w-auto"
              >
                <Link href="/docs">Read the docs</Link>
              </Button>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}

const FAQ: [string, string][] = [
  [
    "Who holds the money?",
    "You do. Each program has its own vault contract owned by your wallet. You can withdraw at any time, even while the vault is paused. Misthos never takes custody of funds.",
  ],
  [
    "What if the agent gets it wrong?",
    "Anything uncertain comes to you before it's paid: low confidence, unusual engagement, large amounts, or text that tries to steer the grader. You can override any decision before the round pays, and contributors always see the reason.",
  ],
  [
    "Can contributors game the AI?",
    "Submitted content is treated as untrusted data. Attempts to instruct the grader are detected in code and always go to a human. The model only scores the work; plain rules decide the outcome, and hard checks like authorship can't be talked around.",
  ],
  [
    "What kinds of work can it check?",
    "Posts and threads on X, GitHub pull requests and commits, and articles on the open web. It reads only the links contributors submit.",
  ],
  [
    "What does it cost?",
    "Misthos runs on Arc testnet today, with test USDC. Mainnet support comes after the testnet period.",
  ],
  [
    "What data do you keep?",
    "The submitted links and the content fetched from them, the contributor's X id and handle, GitHub username and payout wallet. The X sign-in token is revoked right after reading the profile.",
  ],
];

function Section({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <section id={id} className="mx-auto max-w-[1200px] scroll-mt-20 px-4 pt-28 sm:px-6 md:pt-40">
      {children}
    </section>
  );
}

function SectionHeading({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="max-w-[40rem]">
      <h2 className="text-[28px] leading-[1.12] font-medium tracking-[-0.025em] text-balance sm:text-[36px]">
        {title}
      </h2>
      {children ? <p className="text-soft mt-4 text-[17px] leading-relaxed">{children}</p> : null}
    </div>
  );
}

function Metric({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="px-1">
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="mt-1 font-mono text-3xl font-medium tracking-tight">{children}</dd>
    </div>
  );
}

function Guardrail({ title, children }: { title: string; children: ReactNode }) {
  return (
    <li className="p-5 sm:p-6">
      <p className="font-medium">{title}</p>
      <p className="text-soft mt-1 text-[15px] leading-relaxed">{children}</p>
    </li>
  );
}

function DecisionCard({ example: e, slug }: { example: Example; slug: string }) {
  return (
    <article className="bg-card rounded-xl border p-5 sm:p-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <ActionBadge action={e.action} />
        <span className="font-medium">@{e.handle}</span>
        <span className="text-muted-foreground text-sm">
          {SOURCE_LABEL[e.sourceType as SourceType] ?? e.sourceType}
        </span>
        {e.action === "approve" ? (
          <span className="ml-auto font-mono text-sm tabular-nums">{formatUsdc(e.amount)}</span>
        ) : null}
      </div>
      <p
        className={cn(
          "mt-3 leading-relaxed",
          e.action === "reject" ? "text-foreground" : "text-soft",
        )}
      >
        {e.summary}
      </p>
      <div className="text-muted-foreground mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
        <span className="font-mono">{shortHex(e.hash, 6, 4)}</span>
        {e.flags.length ? <span className="font-mono">{e.flags.join(", ")}</span> : null}
        <Link
          prefetch={false}
          href={`/p/${slug}#verify?d=${e.hash}`}
          className="text-foreground ml-auto rounded-sm underline underline-offset-4"
        >
          Verify this decision
        </Link>
      </div>
    </article>
  );
}
