import { formatUsdc } from "@misthos/shared";
import Link from "next/link";
import { ProgramStatus } from "@/components/app/program-status";
import { ActionBadge } from "@/components/public/action-badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState, Notice, PageHeader, Section, Stat, TableFrame } from "@/components/ui-kit";
import { ownerOverview } from "@/lib/server/overview";
import { getOwnerSession } from "@/lib/server/session";

const STATUS_ORDER = [
  ["escalated", "Needs review"],
  ["pending", "Queued"],
  ["approved", "Approved"],
  ["partial", "Partial"],
  ["paid", "Paid"],
  ["rejected", "Rejected"],
] as const;

export default async function OverviewPage() {
  const session = await getOwnerSession();
  if (!session) return null; // layout renders sign-in
  const o = await ownerOverview(session.sub);

  if (!o) {
    return (
      <div className="grid gap-8">
        <PageHeader title="Overview" />
        <EmptyState action={{ label: "Create a program", href: "/app/programs/new" }}>
          You don&apos;t run any programs yet. Set up the rules once and the agent handles review
          and payouts.
        </EmptyState>
      </div>
    );
  }

  const queued = (o.byStatus.pending ?? 0) + (o.byStatus.processing ?? 0);
  const next = o.forecast[0];

  return (
    <div className="grid gap-10">
      <PageHeader
        title="Overview"
        actions={
          <Button asChild size="sm">
            <Link href="/app/programs/new">New program</Link>
          </Button>
        }
      />

      {o.awaitingApproval.length || o.payeeChanges.length ? (
        <div className="grid gap-2">
          {o.awaitingApproval.map(({ r, name }) => (
            <Notice key={r.id}>
              <Link
                href={`/app/programs/${r.programId}/rounds/${r.id}`}
                className="underline underline-offset-4"
              >
                {name}: round {r.number} ({formatUsdc(r.totalAmount)}) is waiting for your approval.
              </Link>
            </Notice>
          ))}
          {o.payeeChanges.map(({ c, name }) => (
            <Notice key={c.id}>
              {name}: @{c.xHandle} changed their payout wallet on{" "}
              {c.walletChangedAt!.toISOString().slice(0, 10)}. Payments to it wait out the cooldown;
              confirm the change was really them.
            </Notice>
          ))}
        </div>
      ) : null}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Totals">
        <Stat
          label="Vault balance"
          value={formatUsdc(o.vaultBalance, { withSymbol: false })}
          hint={`USDC across ${o.vaultCount} vault${o.vaultCount === 1 ? "" : "s"}`}
        />
        <Stat
          label="Next payout"
          value={next ? formatUsdc(next.amount, { withSymbol: false }) : "0.00"}
          hint={
            next
              ? `${next.program.name}${next.dueAt ? `, round closes ${next.dueAt.toISOString().slice(0, 10)}` : ""}${next.capped ? " (capped by round limit)" : ""}`
              : "No approved work waiting"
          }
        />
        <Stat
          label="Needs review"
          value={o.byStatus.escalated ?? 0}
          hint={queued ? `${queued} queued for the agent` : "Nothing queued"}
        />
        <Stat
          label="Fraud caught"
          value={o.fraudCaught}
          hint="Copied, not theirs, out of window or gamed"
        />
      </section>

      <div className="grid gap-10 lg:grid-cols-[1fr_320px]">
        <Section title="Recent agent decisions">
          {o.feed.length === 0 ? (
            <EmptyState>No decisions yet. They appear here as contributors submit work.</EmptyState>
          ) : (
            <ul className="bg-card divide-y rounded-lg border">
              {o.feed.map((d) => (
                <li key={d.hash} className="grid gap-1 p-4">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    <ActionBadge action={d.action} />
                    <span>@{d.handle}</span>
                    <Link
                      href={`/app/programs/${d.programId}/submissions`}
                      className="text-muted-foreground hover:underline"
                    >
                      {d.programName}
                    </Link>
                    <span className="text-muted-foreground mono-num ml-auto text-xs">
                      {d.createdAt.toISOString().slice(5, 16).replace("T", " ")}
                    </span>
                  </div>
                  <p className="text-sm">{d.summary}</p>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Submissions">
          <dl className="bg-card grid grid-cols-[1fr_auto] gap-y-2 rounded-lg border p-4 text-sm">
            {STATUS_ORDER.map(([key, label]) => (
              <div key={key} className="contents">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="mono-num">{key === "pending" ? queued : (o.byStatus[key] ?? 0)}</dd>
              </div>
            ))}
          </dl>
        </Section>
      </div>

      <Section title="Programs">
        <TableFrame>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Program</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="text-right">Vault balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {o.programs.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <Link href={`/app/programs/${p.id}`} className="font-medium hover:underline">
                      {p.name}
                    </Link>
                    <div className="text-muted-foreground font-mono text-xs">/{p.slug}</div>
                  </TableCell>
                  <TableCell>
                    <ProgramStatus status={p.status} />
                    {p.isDemo ? (
                      <span className="text-muted-foreground ml-2 text-xs">demo</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="capitalize">{p.role}</TableCell>
                  <TableCell className="mono-num text-right">
                    {p.vault ? (
                      formatUsdc(p.vault.balance, { withSymbol: false })
                    ) : (
                      <span className="text-muted-foreground">No vault yet</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableFrame>
      </Section>
    </div>
  );
}
