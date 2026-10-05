import { formatUsdc } from "@misthos/shared";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { FocusHeader, FocusMain } from "@/components/app/focus-frame";
import { SealArt } from "@/components/brand/illustrations";
import { Button } from "@/components/ui/button";
import { Stepper } from "@/components/ui-kit/stepper";
import { appOrigin } from "@/lib/server/env";
import { programSummary } from "@/lib/server/program-summary";
import { getOwnerSession } from "@/lib/server/session";
import { programNameForTitle } from "@/lib/server/titles";
import { setupCurrent, setupSteps } from "@/lib/setup-flow";
import { utc } from "@/lib/time";

export async function generateMetadata({ params }: PageProps<"/app/programs/[id]/ready">) {
  const name = await programNameForTitle((await params).id);
  return { title: name ? `${name} is ready` : "Program ready" };
}

/**
 * Right after the wizard: a moment to confirm what was created, then one clear next step (the guided vault setup).
 * Revisiting it later shows the same summary with the steps already done ticked off.
 */
export default async function ProgramReadyPage({ params }: PageProps<"/app/programs/[id]/ready">) {
  const session = await getOwnerSession();
  if (!session) return null; // the /app layout renders sign-in
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const summary = await programSummary(id, session.sub);
  if (!summary) notFound();
  const { program, vault } = summary;
  const base = `/app/programs/${program.id}`;
  const state = {
    vaultDeployed: !!program.vaultAddress,
    funded: !!vault && vault.totalDeposited > 0n,
    published: program.status === "active" || program.status === "paused",
  };
  const current = setupCurrent(state);
  const joinHost = `${appOrigin().replace(/^https?:\/\//, "")}/join/${program.slug}`;
  const limits = program.limitsJson;
  const round = summary.round;

  return (
    <>
      <FocusHeader
        exit={
          <Button asChild variant="ghost" size="sm">
            <Link href={base}>Go to overview</Link>
          </Button>
        }
      />
      <FocusMain className="mx-auto w-full max-w-3xl px-4 pt-10 pb-20 sm:px-8 sm:pt-16">
        <div className="grid justify-items-center text-center">
          <SealArt className="size-24 sm:size-28" />
          <p className="text-brand mt-6 text-sm font-medium">Saved as a draft</p>
          <h1 className="display mt-2 text-[2.75rem] leading-[1.02] sm:text-[3.75rem]">
            Your program is <em>ready</em>
          </h1>
          <p className="text-soft mt-4 max-w-[52ch] text-[15px] leading-relaxed">
            <span className="text-foreground font-medium">{program.name}</span> has its rules,
            budget and limits. Three short steps put it live; nothing is public and no money has
            moved yet.
          </p>
        </div>

        <section
          aria-labelledby="next-h"
          className="bg-card shadow-lift mt-10 grid gap-6 rounded-[1.5rem] p-6 sm:p-8"
        >
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 id="next-h" className="display text-[1.75rem] leading-tight">
              Go live in three steps
            </h2>
            <p className="text-muted-foreground text-sm">About three minutes</p>
          </div>
          <Stepper
            orientation="responsive"
            label="Steps to go live"
            steps={setupSteps(state).map((s) => ({ key: s.key, label: s.label, status: s.status }))}
          />
          <div className="flex flex-wrap items-center gap-2 border-t pt-6">
            {current === "live" ? (
              <Button asChild size="lg" className="h-11 px-5 text-[15px]">
                <Link href={base}>
                  Open the program
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
              </Button>
            ) : (
              <Button asChild size="lg" className="h-11 px-5 text-[15px]">
                <Link href={`${base}/setup`}>
                  {current === "deploy"
                    ? "Set up the vault"
                    : current === "fund"
                      ? "Fund the vault"
                      : "Publish the join page"}
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
              </Button>
            )}
            <Button asChild variant="ghost" size="lg" className="h-11 px-5 text-[15px]">
              <Link href={base}>Go to overview</Link>
            </Button>
          </div>
        </section>

        <section aria-labelledby="summary-h" className="mt-6 grid gap-3">
          <h2 id="summary-h" className="sr-only">
            What you created
          </h2>
          <dl className="bg-card shadow-soft grid gap-x-8 gap-y-4 rounded-[1.5rem] p-6 text-sm sm:grid-cols-[150px_minmax(0,1fr)] sm:p-8">
            <dt className="text-muted-foreground">Join link</dt>
            <dd className="min-w-0">
              <span className="font-mono text-[13px] [overflow-wrap:anywhere]">{joinHost}</span>
              <span className="text-muted-foreground block text-xs">
                Opens once you publish the join page
              </span>
            </dd>
            <dt className="text-muted-foreground">Pays for</dt>
            <dd className="grid gap-1">
              {program.rubricJson.categories.map((c) => (
                <span key={c.key} className="flex flex-wrap justify-between gap-x-4">
                  <span>{c.name}</span>
                  <span className="mono-num text-muted-foreground">
                    up to {formatUsdc(program.ratePerPoint * BigInt(c.maxPoints))}
                  </span>
                </span>
              ))}
            </dd>
            <dt className="text-muted-foreground">Round 1</dt>
            <dd>
              {round
                ? round.scheduled
                  ? `Starts ${utc(round.startsAt)}`
                  : `Open now, until ${utc(round.endsAt)}`
                : `Starts ${utc(program.firstRoundStartsAt)}`}
              <span className="text-muted-foreground block text-xs">
                Every {program.roundLengthDays} days after that
              </span>
            </dd>
            <dt className="text-muted-foreground">Vault limits</dt>
            <dd className="grid gap-0.5">
              <span>{formatUsdc(BigInt(limits.maxPerPayout))} per contributor per round</span>
              <span>
                {formatUsdc(BigInt(limits.maxPerRound))} per round ·{" "}
                {formatUsdc(BigInt(limits.maxPerDay))} per 24 hours
              </span>
              <span>Your approval above {formatUsdc(BigInt(limits.autoApproveThreshold))}</span>
            </dd>
          </dl>
          <p className="text-muted-foreground text-center text-xs">
            Everything here can be changed later in{" "}
            <Link
              href={`${base}/settings`}
              className="text-foreground underline underline-offset-4"
            >
              Settings
            </Link>
            .
          </p>
        </section>
      </FocusMain>
    </>
  );
}
