import Link from "next/link";
import type { Address } from "viem";
import { ProgramStatus } from "@/components/app/program-status";
import { HexValue } from "@/components/hex-value";
import { Card, EmptyState, Notice, PageHeader } from "@/components/ui-kit";
import { CopyField } from "@/components/ui-kit/copy-field";
import { Term } from "@/components/ui-kit/term";
import { LimitsForm, OwnerWallet } from "@/components/vault/islands";
import { unitsToInput } from "@/lib/units";
import { appOrigin } from "@/lib/server/env";
import { getProgramForMember, getRounds } from "@/lib/server/queries";
import { RoundSchedule } from "@/components/app/round-schedule";
import { getOwnerSession } from "@/lib/server/session";
import { explorerAddress, readVault } from "@/lib/server/vault";
import { PublishButton } from "../publish-button";
import { ShareOnX } from "@/components/app/share-on-x";
import { shareOnXUrl } from "@/lib/share";

export const metadata = { title: "Settings" };

const JOINING: Record<string, string> = {
  draft: "Not published. Contributors can't join yet.",
  active: "Open. Anyone with the link can join.",
  paused: "Paused. Existing contributors can still submit; nobody new can join.",
  archived: "Archived.",
};

export default async function SettingsPage({ params }: PageProps<"/app/programs/[id]/settings">) {
  const session = await getOwnerSession();
  if (!session) return null;
  const { id } = await params;
  const row = await getProgramForMember(id, session.sub);
  if (!row) return null;
  const base = `/app/programs/${id}`;
  const crumbs = [{ label: row.program.name, href: base }, { label: "Settings" }];
  if (row.role !== "owner")
    return (
      <div className="grid gap-6">
        <PageHeader crumbs={crumbs} title="Settings" />
        <Notice tone="info">Only the program owner can change settings.</Notice>
      </div>
    );
  const vault = row.program.vaultAddress as Address | null;
  const state = vault ? await readVault(vault) : null;
  const joinUrl = `${appOrigin()}/join/${row.program.slug}`;
  const latest = (await getRounds(id)).at(-1) ?? null;
  const l = state?.limits;
  return (
    <div className="grid max-w-3xl gap-6">
      <PageHeader
        crumbs={crumbs}
        title="Settings"
        description="The join page, round schedule, vault and the limits it enforces."
        actions={<OwnerWallet owner={session.addr} />}
      />

      <Card title="Join page" actions={<ProgramStatus status={row.program.status} />}>
        <div className="grid gap-4">
          <p className="text-sm">{JOINING[row.program.status]}</p>
          <CopyField
            value={joinUrl}
            label="join link"
            display={joinUrl.replace(/^https?:\/\//, "")}
          />
          <div className="flex flex-wrap gap-2">
            <PublishButton programId={id} status={row.program.status} />
            {row.program.status === "active" ? (
              <ShareOnX
                href={shareOnXUrl({
                  name: row.program.name,
                  joinUrl,
                  sources: [
                    ...new Set(row.program.rubricJson.categories.flatMap((c) => c.sourceTypes)),
                  ],
                  bestPayout: row.program.rubricJson.categories.reduce(
                    (m, c) =>
                      row.program.ratePerPoint * BigInt(c.maxPoints) > m
                        ? row.program.ratePerPoint * BigInt(c.maxPoints)
                        : m,
                    0n,
                  ),
                })}
              />
            ) : null}
          </div>
        </div>
      </Card>

      <Card
        id="schedule"
        title="Round schedule"
        description="When rounds start and how long they last. Approved work is paid when each round closes."
      >
        <RoundSchedule
          programId={id}
          roundLengthDays={row.program.roundLengthDays}
          round={
            latest
              ? {
                  number: latest.number,
                  startsAt: latest.startsAt.toISOString(),
                  endsAt: latest.endsAt.toISOString(),
                }
              : null
          }
        />
      </Card>

      <Card
        title="Vault"
        description={
          <>
            The <Term k="vault">vault</Term> holds this program&apos;s USDC. You own it; the{" "}
            <Term k="agent">agent</Term> can only pay out inside the limits below.
          </>
        }
      >
        {vault && state ? (
          <dl className="grid gap-3 text-sm sm:grid-cols-[140px_1fr]">
            <dt className="text-muted-foreground">Address</dt>
            <dd>
              <HexValue value={vault} label="vault address" href={explorerAddress(vault)} />
            </dd>
            <dt className="text-muted-foreground">Owner (you)</dt>
            <dd>
              <HexValue
                value={state.owner}
                label="owner address"
                href={explorerAddress(state.owner)}
              />
            </dd>
            <dt className="text-muted-foreground">Agent</dt>
            <dd>
              <HexValue
                value={state.agent}
                label="agent address"
                href={explorerAddress(state.agent)}
              />
            </dd>
            <dt className="text-muted-foreground">Payouts</dt>
            <dd>
              {state.paused ? "Paused" : "Running"} ·{" "}
              <Link
                href={`${base}/treasury#vault-controls`}
                className="underline underline-offset-4"
              >
                {state.paused ? "Resume" : "Pause"} or withdraw in Treasury
              </Link>
            </dd>
          </dl>
        ) : (
          <EmptyState action={{ label: "Deploy the vault", href: base }}>
            The vault isn&apos;t deployed yet.
          </EmptyState>
        )}
      </Card>

      <Card
        id="limits"
        title="Limits"
        description="Enforced by the vault contract. Changing them is one transaction from your wallet; rounds already waiting are re-checked against the new limits before they pay."
      >
        {vault && l ? (
          <LimitsForm
            programId={id}
            vault={vault}
            owner={session.addr as Address}
            current={{
              maxPerPayout: unitsToInput(l.maxPerPayout),
              maxPerRound: unitsToInput(l.maxPerRound),
              maxPerDay: unitsToInput(l.maxPerDay),
              autoApproveThreshold: unitsToInput(l.autoApproveThreshold),
              payeeCooldownHours: String(Number(l.payeeCooldown) / 3600),
            }}
          />
        ) : (
          <p className="text-muted-foreground text-sm">
            Limits can be changed once the vault is deployed.
          </p>
        )}
      </Card>
    </div>
  );
}
