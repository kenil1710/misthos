import { formatUsdc, shortHex } from "@misthos/shared";
import { SOURCE_LABEL, type SourceType } from "@misthos/shared/sources";
import {
  ArrowUpRight,
  BadgeCheck,
  CircleDollarSign,
  Fuel,
  KeyRound,
  Plus,
  Repeat2,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, type ComponentType, type ReactNode } from "react";
import { SignedOutNotice } from "@/components/landing/signed-out-notice";
import {
  BoxArt,
  CoinsArt,
  CopyArt,
  LinkArt,
  RubricArt,
  SealArt,
  StackArt,
  VaultArt,
} from "@/components/brand/illustrations";
import { CountUp } from "@/components/landing/count-up";
import { HeroMoment } from "@/components/landing/hero-moment";
import { Reveal } from "@/components/landing/reveal";
import { SiteFooter, SiteHeader } from "@/components/landing/site-chrome";
import { ActionBadge } from "@/components/public/action-badge";
import { Button } from "@/components/ui/button";
import { Stepper } from "@/components/ui-kit/stepper";
import { explorerAddress } from "@/lib/landing-links";
import { type Example, landingData } from "@/lib/server/landing";
import { cn } from "@/lib/utils";

// Live numbers and examples, refreshed every five minutes.
export const revalidate = 300;

export const metadata: Metadata = {
  title: { absolute: "Misthos: launch a campaign, AI pays your community for real work" },
  alternates: { canonical: "/" },
};

export default async function Home() {
  const { metrics, showMetrics, featured, examples } = await landingData();
  // Always offer the live showcase, so visitors can see it working without signing in.
  const auditHref = `/p/${featured?.slug ?? "kency-arc-creators"}`;
  const verifyHref = featured
    ? `/p/${featured.slug}#verify${examples.approved ? `?d=${examples.approved.hash}` : ""}`
    : null;
  const limits = featured?.limits;

  return (
    <>
      <SiteHeader />
      <Suspense fallback={null}>
        <SignedOutNotice />
      </Suspense>
      <main id="main" className="flex-1">
        {/* 1 · Hero */}
        <section className="mx-auto grid max-w-[1240px] grid-cols-[minmax(0,1fr)] items-center gap-14 px-4 pt-14 sm:px-6 md:pt-24 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] lg:gap-10">
          <div>
            <h1 className="display text-[2.75rem] leading-[1.02] sm:text-[4rem] lg:text-[4.75rem]">
              <span className="block">Launch a campaign.</span>
              <span className="block">
                AI pays your community for <em>real</em> work.
              </span>
            </h1>
            <p className="text-soft mt-7 max-w-[36rem] text-lg leading-relaxed sm:text-xl">
              Fund a USDC vault and set the rules. People create threads, articles and code about
              your project. An AI agent checks every submission, scores it and pays them
              automatically, never above the limits your vault enforces.
            </p>
            <div className="mt-10 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg" className="h-12 rounded-xl px-6 text-base">
                <Link href="/app" prefetch={false}>
                  Launch a campaign
                </Link>
              </Button>
              {auditHref ? (
                <Button
                  asChild
                  variant="ghost"
                  size="lg"
                  className="bg-card/70 hover:bg-card h-12 rounded-xl px-6 text-base"
                >
                  <Link href={auditHref} prefetch={false}>
                    See it live
                    <ArrowUpRight className="size-4" strokeWidth={1.5} aria-hidden="true" />
                  </Link>
                </Button>
              ) : null}
            </div>
            <p className="text-muted-foreground mt-6 text-sm">
              Live on Arc testnet with test USDC.
            </p>
          </div>
          <div className="flex justify-center lg:justify-end">
            <HeroMoment />
          </div>
        </section>

        {/* Live numbers: real, non-demo programs only, hidden until there is something to show. */}
        {showMetrics && metrics ? (
          <section aria-label="Live numbers" className="mx-auto mt-28 max-w-[1240px] px-4 sm:px-6">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-10 md:grid-cols-4">
              <BigNumber label="USDC paid out">
                <CountUp
                  value={Number(metrics.usdcPaidTestnet + metrics.usdcPaidMainnet) / 1e6}
                  decimals={2}
                />
              </BigNumber>
              <BigNumber label="Submissions reviewed">
                <CountUp value={metrics.submissionsReviewed} />
              </BigNumber>
              <BigNumber label="People paid">
                <CountUp value={metrics.contributorsPaid} />
              </BigNumber>
              <BigNumber label="Rounds paid on Arc">
                <CountUp value={metrics.roundsExecuted} />
              </BigNumber>
            </dl>
          </section>
        ) : null}

        {/* 2 · The problem */}
        <Section>
          <Heading
            title={
              <>
                Paying your community by hand stops working at <em>fifty</em> people.
              </>
            }
          />
          <div className="mt-16 grid gap-5 md:grid-cols-3">
            {(
              [
                [
                  StackArt,
                  "Review doesn't scale",
                  "Every link means opening it, checking who wrote it and when, and judging it. Checks get skipped.",
                ],
                [
                  CopyArt,
                  "Farming is cheap",
                  "Copied threads, someone else's pull request, work from before the campaign started: unchecked, all of it gets paid.",
                ],
                [
                  BoxArt,
                  "Payouts are a black box",
                  "People can't see why they got what they got, and you can't see where the budget went.",
                ],
              ] as [ComponentType<{ className?: string }>, string, string][]
            ).map(([Art, title, body], i) => (
              <Reveal key={title} delay={i * 80}>
                <article className="bg-card shadow-soft h-full rounded-3xl p-7">
                  <Art className="size-28" />
                  <h3 className="mt-6 text-lg font-medium">{title}</h3>
                  <p className="text-soft mt-2 leading-relaxed">{body}</p>
                </article>
              </Reveal>
            ))}
          </div>
        </Section>

        {/* 3 · How it works */}
        <Section id="how-it-works">
          <Heading
            title={
              <>
                You set the rules once. The rest is <em>handled</em>.
              </>
            }
          >
            The AI agent checks the work. Your vault pays for it.
          </Heading>
          <ol className="mt-16 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {(
              [
                [
                  RubricArt,
                  "Launch a campaign",
                  "Say what you pay for and how it's scored, set your limits, and fund a USDC vault you own.",
                ],
                [
                  LinkArt,
                  "Your community posts",
                  "People sign in with X, add a wallet for payouts, and paste links to their threads, articles or code.",
                ],
                [
                  SealArt,
                  "AI checks every link",
                  "It checks who made it, that it's original and on time, scores it, and signs each decision with its reasons.",
                ],
                [
                  CoinsArt,
                  "They get paid",
                  "When a round ends, your vault pays approved work in USDC, never above your limits.",
                ],
              ] as [ComponentType<{ className?: string }>, string, string][]
            ).map(([Art, title, body], i) => (
              <li key={title}>
                <Reveal delay={i * 70} className="h-full">
                  <div className="bg-card shadow-soft flex h-full flex-col rounded-3xl p-6">
                    <span className="text-muted-foreground font-mono text-xs">/0{i + 1}</span>
                    <Art className="mt-4 size-24" />
                    <h3 className="mt-5 font-medium">{title}</h3>
                    <p className="text-soft mt-1.5 text-[15px] leading-relaxed">{body}</p>
                  </div>
                </Reveal>
              </li>
            ))}
          </ol>
        </Section>

        {/* 4 · Decisions */}
        {featured && (examples.approved || examples.rejected) ? (
          <Section>
            <Heading
              title={
                <>
                  Every decision comes with its <em>reasons</em>.
                </>
              }
            >
              Approvals say what earned the points. Rejections say what failed, in words people can
              act on. These two are real
              {featured.isDemo ? ", from the public demo program" : ""}.
            </Heading>
            <div className="mt-16 grid gap-5 lg:grid-cols-2">
              {[examples.approved, examples.rejected].map((e, i) =>
                e ? (
                  <Reveal key={e.hash} delay={i * 80}>
                    <DecisionCard example={e} slug={featured.slug} />
                  </Reveal>
                ) : null,
              )}
            </div>
          </Section>
        ) : null}

        {/* 5 · Guardrails */}
        <Section id="guardrails">
          <div className="bg-card shadow-soft grid gap-10 overflow-hidden rounded-[2rem] p-7 sm:p-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:p-14">
            <div>
              <Heading
                title={
                  <>
                    The AI decides. Your <em>vault</em> sets the limits.
                  </>
                }
              >
                Payouts leave from a vault your wallet owns. Anything above your limits is refused
                on-chain, whatever the AI decided.
              </Heading>
              <VaultArt className="mt-8 size-44 sm:size-52" />
            </div>
            <div className="grid grid-cols-2 content-center gap-3 sm:gap-4">
              <Cap
                label="Per person, per round"
                value={
                  limits ? formatUsdc(BigInt(limits.maxPerPayout), { withSymbol: false }) : null
                }
                unit="USDC"
              />
              <Cap
                label="Per round"
                value={
                  limits ? formatUsdc(BigInt(limits.maxPerRound), { withSymbol: false }) : null
                }
                unit="USDC"
              />
              <Cap
                label="Per rolling 24 hours"
                value={limits ? formatUsdc(BigInt(limits.maxPerDay), { withSymbol: false }) : null}
                unit="USDC"
              />
              <Cap
                label="Your signature above"
                value={
                  limits
                    ? formatUsdc(BigInt(limits.autoApproveThreshold), { withSymbol: false })
                    : null
                }
                unit="USDC"
              />
              <p className="text-soft col-span-2 text-sm leading-relaxed">
                {limits ? "The demo vault's limits. " : ""}New payout wallets wait out a cooldown,
                each payout has a fixed id and is paid once, and you can pause and withdraw at any
                time.
                {featured?.vaultAddress ? (
                  <>
                    {" "}
                    <a
                      href={explorerAddress(featured.vaultAddress)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-foreground inline-flex items-center gap-0.5 underline underline-offset-4"
                    >
                      See it on Arc
                      <ArrowUpRight className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
                    </a>
                  </>
                ) : null}
              </p>
            </div>
          </div>
        </Section>

        {/* 6 · Verify */}
        <Section>
          <div className="grid items-start gap-12 lg:grid-cols-2">
            <div>
              <Heading
                title={
                  <>
                    Don&apos;t take the agent&apos;s <em>word</em> for it.
                  </>
                }
              >
                Every decision is a record signed by the agent&apos;s wallet, and every payout on
                Arc carries its hash. Anyone can check the whole chain in one click.
              </Heading>
              {verifyHref ? (
                <Button
                  asChild
                  size="lg"
                  variant="outline"
                  className="mt-9 h-12 rounded-xl px-6 text-base"
                >
                  <Link href={verifyHref} prefetch={false}>
                    Verify a decision yourself
                  </Link>
                </Button>
              ) : null}
            </div>
            <Reveal>
              <div className="bg-card shadow-soft rounded-3xl p-6 sm:p-8">
                <p className="text-muted-foreground text-sm">Five checks, run in your browser</p>
                <Stepper
                  className="mt-5"
                  label="Verification checks"
                  steps={[
                    [
                      "record",
                      "Record hash matches",
                      "The record is re-hashed exactly as published.",
                    ],
                    [
                      "published",
                      "Published by Misthos",
                      "The same hash is on the program's audit page.",
                    ],
                    [
                      "signature",
                      "Signed by the agent",
                      "The agent's Circle wallet signed it (ERC-1271 on Arc).",
                    ],
                    [
                      "payout",
                      "Included in a payout",
                      "The payout's hash commits to this decision.",
                    ],
                    [
                      "chain",
                      "Matches the on-chain payment",
                      "The vault's PayoutExecuted event on Arc carries it.",
                    ],
                  ].map(([key, label, detail]) => ({
                    key,
                    label,
                    detail,
                    status: "done" as const,
                  }))}
                />
              </div>
            </Reveal>
          </div>
        </Section>

        {/* 7 · Built on */}
        <Section>
          <Heading
            title={
              <>
                Built on Arc and <em>Circle</em>.
              </>
            }
          >
            Only what Misthos uses, and what for.
          </Heading>
          <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {(
              [
                [
                  CircleDollarSign,
                  "USDC on Arc",
                  "Payouts settle in USDC, and gas is paid in USDC too.",
                ],
                [
                  KeyRound,
                  "Circle Wallets",
                  "The agent is a smart-contract wallet. No raw key on a server.",
                ],
                [Fuel, "Gas Station", "Circle sponsors the agent's gas, so it never holds funds."],
                [
                  Repeat2,
                  "Idempotent payouts",
                  "Every payout call has a key, so a retry can't pay twice.",
                ],
              ] as [ComponentType<{ className?: string; strokeWidth?: number }>, string, string][]
            ).map(([Icon, title, body], i) => (
              <Reveal key={title} delay={i * 60}>
                <div className="bg-card shadow-soft h-full rounded-2xl p-5">
                  <span className="bg-brand-subtle text-brand flex size-10 items-center justify-center rounded-xl">
                    <Icon className="size-5" strokeWidth={1.5} />
                  </span>
                  <h3 className="mt-4 font-medium">{title}</h3>
                  <p className="text-soft mt-1 text-sm leading-relaxed">{body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </Section>

        {/* 8 · FAQ */}
        <Section id="faq">
          <div className="grid gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
            <div>
              <Heading
                title={
                  <>
                    Questions, <em>answered</em>.
                  </>
                }
              />
              <p className="text-soft mt-5 leading-relaxed">
                Something else?{" "}
                <Link href="/docs/faq" className="text-foreground underline underline-offset-4">
                  Read the full FAQ
                </Link>{" "}
                or the{" "}
                <Link href="/docs" className="text-foreground underline underline-offset-4">
                  docs
                </Link>
                .
              </p>
            </div>
            <div className="grid gap-3">
              {FAQ.map(([q, a]) => (
                <details key={q} className="group bg-card shadow-soft rounded-2xl px-5 sm:px-6">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-5 text-[17px] font-medium [&::-webkit-details-marker]:hidden">
                    {q}
                    <span
                      aria-hidden="true"
                      className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-full transition-transform duration-300 group-open:rotate-45"
                    >
                      <Plus className="size-4" strokeWidth={1.75} />
                    </span>
                  </summary>
                  <p className="text-soft max-w-[62ch] pb-6 leading-relaxed">{a}</p>
                </details>
              ))}
            </div>
          </div>
        </Section>

        {/* 9 · Final call */}
        <Section>
          <div className="bg-primary text-primary-foreground relative overflow-hidden rounded-[2rem] px-7 py-16 text-center sm:px-12 md:py-24">
            <CoinsArt className="pointer-events-none absolute -bottom-6 -left-6 size-44 opacity-25 sm:size-56" />
            <SealArt className="pointer-events-none absolute -top-8 -right-6 size-40 opacity-25 sm:size-52" />
            <h2 className="display relative mx-auto max-w-3xl text-[2.5rem] leading-[1.02] sm:text-[3.75rem]">
              Launch your first campaign on <em>Misthos</em>.
            </h2>
            <p className="relative mx-auto mt-5 max-w-md text-lg leading-relaxed opacity-80">
              Set it up in a few minutes. You keep the keys and the funds.
            </p>
            <div className="relative mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button
                asChild
                size="lg"
                variant="secondary"
                className="h-12 rounded-xl px-6 text-base"
              >
                <Link href="/app" prefetch={false}>
                  Launch a campaign
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="ghost"
                className="hover:bg-primary-foreground/10 h-12 rounded-xl px-6 text-base text-inherit hover:text-inherit"
              >
                <Link href="/docs">Read the docs</Link>
              </Button>
            </div>
          </div>
        </Section>
      </main>
      <SiteFooter />
    </>
  );
}

const FAQ: [string, string][] = [
  [
    "Who holds the money?",
    "You do. Each program has its own vault contract owned by your wallet. You can withdraw at any time, even while it's paused. Misthos never takes custody of funds.",
  ],
  [
    "What if the agent gets it wrong?",
    "Anything uncertain comes to you before it's paid: low confidence, odd engagement, large amounts, or text that tries to trick the AI. You can change any decision before the round pays.",
  ],
  [
    "Can people game the AI?",
    "Everything people submit is treated as untrusted. Attempts to give the AI instructions are caught in code and always go to you, and hard checks like who wrote it can't be talked around.",
  ],
  [
    "What kinds of work can it check?",
    "Threads and posts on X, articles on the open web, and code on GitHub (pull requests and commits). It reads only the links people submit.",
  ],
  [
    "What does it cost?",
    "Misthos runs on Arc testnet today, with test USDC. Mainnet support comes after the testnet period.",
  ],
  [
    "What data do you keep?",
    "The submitted links and their content, each person's X id and handle, their verified GitHub account and payout wallet. Sign-in tokens are revoked right after reading the profile.",
  ],
];

function Section({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <section id={id} className="mx-auto max-w-[1240px] scroll-mt-24 px-4 pt-32 sm:px-6 md:pt-44">
      {children}
    </section>
  );
}

function Heading({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <Reveal className="max-w-[44rem]">
      <h2 className="display text-[2.5rem] leading-[1.04] sm:text-[3.25rem] lg:text-[3.75rem]">
        {title}
      </h2>
      {children ? (
        <p className="text-soft mt-5 max-w-[34rem] text-lg leading-relaxed">{children}</p>
      ) : null}
    </Reveal>
  );
}

function BigNumber({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dd className="display text-5xl leading-none sm:text-6xl">{children}</dd>
      <dt className="text-muted-foreground mt-3 text-sm">{label}</dt>
    </div>
  );
}

function Cap({ label, value, unit }: { label: string; value: string | null; unit: string }) {
  return (
    <div className="bg-background/70 rounded-2xl p-4 sm:p-5">
      <p className="text-muted-foreground text-xs sm:text-sm">{label}</p>
      <p className="display mt-2 text-[2rem] leading-none sm:text-[2.75rem]">
        {value ?? <span className="text-3xl">You set it</span>}
        {value ? (
          <span className="text-muted-foreground ml-1.5 font-sans text-sm">{unit}</span>
        ) : null}
      </p>
    </div>
  );
}

function DecisionCard({ example: e, slug }: { example: Example; slug: string }) {
  const approved = e.action === "approve";
  return (
    <article className="bg-card shadow-soft flex h-full flex-col rounded-3xl p-6 sm:p-7">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <ActionBadge action={e.action} />
        <span className="font-medium">@{e.handle}</span>
        <span className="text-muted-foreground text-sm">
          {SOURCE_LABEL[e.sourceType as SourceType] ?? e.sourceType}
        </span>
      </div>
      <p
        className={cn(
          "display mt-6 text-4xl leading-none",
          approved ? "text-brand" : "text-muted-foreground",
        )}
      >
        {approved ? (
          <>
            {formatUsdc(e.amount, { withSymbol: false })}{" "}
            <span className="font-sans text-base">USDC</span>
          </>
        ) : (
          "Not paid"
        )}
      </p>
      <p className="text-soft mt-4 flex-1 leading-relaxed">{e.summary}</p>
      <div className="text-muted-foreground mt-6 flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-4 text-[13px]">
        <BadgeCheck className="text-brand size-4" strokeWidth={1.5} aria-hidden="true" />
        <span className="font-mono">{shortHex(e.hash, 6, 4)}</span>
        <Link
          prefetch={false}
          href={`/p/${slug}#verify?d=${e.hash}`}
          className="text-foreground ml-auto rounded-sm underline underline-offset-4"
        >
          Verify
        </Link>
      </div>
    </article>
  );
}
