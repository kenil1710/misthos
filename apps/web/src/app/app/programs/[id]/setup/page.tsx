import { formatUsdc, shortHex } from "@misthos/shared";
import { ArrowRight, ArrowUpRight, ExternalLink } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import type { Address } from "viem";
import { z } from "zod";
import { FocusHeader, FocusMain } from "@/components/app/focus-frame";
import { ShareOnX } from "@/components/app/share-on-x";
import { CoinsArt, LinkArt, SealArt, VaultArt } from "@/components/brand/illustrations";
import { Button } from "@/components/ui/button";
import { WalletChipStatus } from "@/components/web3/islands";
import { Notice } from "@/components/ui-kit";
import { CopyField } from "@/components/ui-kit/copy-field";
import { Stepper } from "@/components/ui-kit/stepper";
import { Term } from "@/components/ui-kit/term";
import { DeployVault, FundVault } from "@/components/vault/islands";
import { appOrigin } from "@/lib/server/env";
import { programSummary } from "@/lib/server/program-summary";
import { getOwnerSession } from "@/lib/server/session";
import { programNameForTitle } from "@/lib/server/titles";
import {
  agentAddress,
  explorerAddress,
  factoryAddress,
  programIdBytes32,
  usdcAddress,
} from "@/lib/server/vault";
import { fundSuggestions, setupCurrent, setupSteps, type SetupKey } from "@/lib/setup-flow";
import { shareOnXUrl } from "@/lib/share";
import { PublishButton } from "../publish-button";

export async function generateMetadata({ params }: PageProps<"/app/programs/[id]/setup">) {
  const name = await programNameForTitle((await params).id);
  return { title: name ? `Set up ${name}` : "Set up" };
}

const ORDER: SetupKey[] = ["deploy", "fund", "publish"];

/**
 * The guided way live: deploy the vault, fund it, publish the join page, one screen per step. The step comes from
 * the program's real state, so a confirmed transaction (which refreshes the page) moves the flow on by itself, and
 * leaving halfway resumes at the same place. Ends on "You're live" with the link to share.
 */
export default async function ProgramSetupPage({ params }: PageProps<"/app/programs/[id]/setup">) {
  const session = await getOwnerSession();
  if (!session) return null;
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const summary = await programSummary(id, session.sub);
  if (!summary) notFound();
  const { program, vault: vaultState, role } = summary;
  const base = `/app/programs/${program.id}`;
  const state = {
    vaultDeployed: !!program.vaultAddress,
    funded: !!vaultState && vaultState.totalDeposited > 0n,
    published: program.status === "active" || program.status === "paused",
  };
  const current = setupCurrent(state);
  const steps = setupSteps(state);
  const limits = program.limitsJson;
  const agent = agentAddress();
  const vault = program.vaultAddress as Address | null;
  const owner = session.addr as Address;
  const joinUrl = `${appOrigin()}/join/${program.slug}`;
  const isOwner = role === "owner";
  const n = current === "live" ? 3 : ORDER.indexOf(current) + 1;

  return (
    <>
      <FocusHeader
        status={current === "live" ? undefined : <WalletChipStatus owner={session.addr} />}
        progress={
          <span className="text-muted-foreground truncate text-xs sm:text-sm">
            <span className="hidden sm:inline">{program.name} · </span>
            {current === "live" ? "Setup complete" : `Step ${n} of 3`}
          </span>
        }
        exit={
          <Button asChild variant="ghost" size="sm">
            <Link href={base}>{current === "live" ? "Go to overview" : "Finish later"}</Link>
          </Button>
        }
      />
      <FocusMain>
        <div className="mx-auto grid max-w-[1080px] items-start gap-10 pt-8 sm:pt-12 lg:grid-cols-[240px_minmax(0,1fr)] xl:gap-16">
          <nav aria-label="Setup steps" className="lg:sticky lg:top-24">
            <p className="text-muted-foreground mb-4 text-xs font-medium tracking-wide uppercase">
              Go live
            </p>
            <Stepper
              size="sm"
              label="Setup progress"
              steps={steps.map((s) => ({
                key: s.key,
                label: s.label,
                status: s.status,
                meta:
                  s.status === "done"
                    ? s.key === "fund" && vaultState
                      ? formatUsdc(vaultState.balance)
                      : "Done"
                    : undefined,
              }))}
            />
          </nav>

          {current === "live" ? (
            <Panel
              art={<SealArt className="size-24 sm:size-28" />}
              eyebrow="All set"
              title={
                <>
                  You&apos;re <em>live</em>
                </>
              }
              intro="The join page is open and the vault is funded. Share the link: contributors sign in with X, link a wallet and submit their work. The agent reviews each submission in about a minute."
            >
              <CopyField
                value={joinUrl}
                label="join link"
                display={joinUrl.replace(/^https?:\/\//, "")}
              />
              <div className="flex flex-wrap gap-2">
                <ShareOnX
                  size="default"
                  href={shareOnXUrl({
                    name: program.name,
                    joinUrl,
                    sources: [
                      ...new Set(program.rubricJson.categories.flatMap((c) => c.sourceTypes)),
                    ],
                    bestPayout: program.rubricJson.categories.reduce(
                      (m, c) =>
                        program.ratePerPoint * BigInt(c.maxPoints) > m
                          ? program.ratePerPoint * BigInt(c.maxPoints)
                          : m,
                      0n,
                    ),
                  })}
                />
                <Button asChild variant="outline">
                  <Link href={`/join/${program.slug}`} target="_blank">
                    Open the join page
                    <ArrowUpRight className="size-3.5" strokeWidth={1.5} />
                  </Link>
                </Button>
              </div>
              <div className="border-t pt-6">
                <Button asChild size="lg" className="h-11 px-5 text-[15px]">
                  <Link href={base}>
                    Go to the program
                    <ArrowRight className="size-4" aria-hidden="true" />
                  </Link>
                </Button>
              </div>
            </Panel>
          ) : current === "deploy" ? (
            <Panel
              art={<VaultArt className="size-24 sm:size-28" />}
              eyebrow="Step 1 of 3"
              title={
                <>
                  Deploy your <em>vault</em>
                </>
              }
              intro={
                <>
                  One transaction creates this program&apos;s <Term k="vault">vault</Term> on Arc.
                  You own it and can withdraw or pause at any time. The <Term k="agent">agent</Term>{" "}
                  can only pay approved work, inside the limits below.
                </>
              }
            >
              <Facts
                title="The vault will enforce"
                rows={[
                  ["Per contributor per round", formatUsdc(BigInt(limits.maxPerPayout))],
                  ["Per round", formatUsdc(BigInt(limits.maxPerRound))],
                  ["Per 24 hours", formatUsdc(BigInt(limits.maxPerDay))],
                  ["Your approval above", formatUsdc(BigInt(limits.autoApproveThreshold))],
                  ["New wallet cooldown", `${limits.payeeCooldownSeconds / 3600} h`],
                  ["Owner (you)", <Mono key="o">{shortHex(owner)}</Mono>],
                  ["Agent", agent ? <Mono key="a">{shortHex(agent)}</Mono> : "Not configured"],
                ]}
                footer={
                  <>
                    Wrong limits?{" "}
                    <Link
                      href={`${base}/settings#limits`}
                      className="text-foreground underline underline-offset-4"
                    >
                      Change them first
                    </Link>
                    . Arc charges a small network fee in USDC.
                  </>
                }
              />
              {!isOwner ? (
                <p className="text-muted-foreground text-sm">
                  Only the owner can deploy the vault.
                </p>
              ) : !agent ? (
                <Notice tone="danger">
                  The agent wallet isn&apos;t configured on this server
                  (CIRCLE_AGENT_WALLET_ADDRESS).
                </Notice>
              ) : (
                <DeployVault
                  size="lg"
                  programId={program.id}
                  factory={factoryAddress()}
                  programIdBytes32={programIdBytes32(program.id)}
                  owner={owner}
                  agent={agent}
                  limits={{
                    maxPerPayout: limits.maxPerPayout,
                    maxPerRound: limits.maxPerRound,
                    maxPerDay: limits.maxPerDay,
                    autoApproveThreshold: limits.autoApproveThreshold,
                    payeeCooldown: String(limits.payeeCooldownSeconds),
                  }}
                />
              )}
            </Panel>
          ) : current === "fund" ? (
            <Panel
              art={<CoinsArt className="size-24 sm:size-28" />}
              eyebrow="Step 2 of 3"
              title={
                <>
                  Fund the <em>vault</em>
                </>
              }
              intro="Deposit the USDC this program will pay out. Payouts can never exceed what's in the vault, and you can withdraw unused funds at any time, even while it's paused."
            >
              {vault ? (
                <Facts
                  title="Your vault"
                  rows={[
                    [
                      "Address",
                      <a
                        key="v"
                        href={explorerAddress(vault)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-mono text-[13px] underline-offset-4 hover:underline"
                      >
                        {shortHex(vault)}
                        <ExternalLink className="size-3" aria-hidden="true" />
                      </a>,
                    ],
                    ["Balance", vaultState ? formatUsdc(vaultState.balance) : "—"],
                    ["One full round pays at most", formatUsdc(BigInt(limits.maxPerRound))],
                  ]}
                />
              ) : null}
              {isOwner && vault ? (
                <FundVault
                  size="lg"
                  programId={program.id}
                  vault={vault}
                  usdc={usdcAddress()}
                  owner={owner}
                  suggestions={fundSuggestions(BigInt(limits.maxPerRound)).map((s) => ({
                    label: s.label,
                    amount: s.amount.toString(),
                  }))}
                />
              ) : (
                <p className="text-muted-foreground text-sm">Only the owner can fund the vault.</p>
              )}
            </Panel>
          ) : (
            <Panel
              art={<LinkArt className="size-24 sm:size-28" />}
              eyebrow="Step 3 of 3"
              title={
                <>
                  Publish the <em>join page</em>
                </>
              }
              intro="Opening the join page lets contributors sign up with your link. You can pause joining at any time; people who already joined can keep submitting."
            >
              <Facts
                title="Your join link"
                rows={[["Link", <Mono key="j">{joinUrl.replace(/^https?:\/\//, "")}</Mono>]]}
                footer={
                  <Link
                    href={`/join/${program.slug}`}
                    target="_blank"
                    className="text-foreground inline-flex items-center gap-1 underline-offset-4 hover:underline"
                  >
                    Preview the join page
                    <ArrowUpRight className="size-3" strokeWidth={1.5} />
                  </Link>
                }
              />
              {isOwner ? (
                <div>
                  <PublishButton programId={program.id} status={program.status} size="default" />
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">Only the owner can publish.</p>
              )}
            </Panel>
          )}
        </div>
      </FocusMain>
    </>
  );
}

function Panel({
  art,
  eyebrow,
  title,
  intro,
  children,
}: {
  art: ReactNode;
  eyebrow: string;
  title: ReactNode;
  intro: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby="setup-step-h"
      className="bg-card shadow-lift relative grid gap-6 overflow-hidden rounded-[1.5rem] p-6 sm:p-10"
    >
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <p className="text-brand text-sm font-medium">{eyebrow}</p>
          <h1
            id="setup-step-h"
            className="display mt-2 text-[2.25rem] leading-[1.05] sm:text-[3rem]"
          >
            {title}
          </h1>
        </div>
        <div className="hidden shrink-0 sm:block">{art}</div>
      </div>
      <p className="text-soft -mt-2 max-w-[58ch] text-[15px] leading-relaxed">{intro}</p>
      {children}
    </section>
  );
}

function Facts({
  title,
  rows,
  footer,
}: {
  title: string;
  rows: [string, ReactNode][];
  footer?: ReactNode;
}) {
  return (
    <div className="bg-muted/50 rounded-[1.25rem] p-5 text-sm">
      <p className="font-medium">{title}</p>
      <dl className="mt-3 grid gap-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
            <dt className="text-soft">{k}</dt>
            <dd className="mono-num min-w-0 [overflow-wrap:anywhere]">{v}</dd>
          </div>
        ))}
      </dl>
      {footer ? <p className="text-muted-foreground mt-3 text-xs">{footer}</p> : null}
    </div>
  );
}

const Mono = ({ children }: { children: ReactNode }) => (
  <span className="font-mono text-[13px]">{children}</span>
);
