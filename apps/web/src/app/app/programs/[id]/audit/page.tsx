import Link from "next/link";
import { AuditDetails } from "@/components/app/audit-details";
import { Button } from "@/components/ui/button";
import { chainConfig } from "@/lib/server/chain";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState, PageHeader, TableFrame } from "@/components/ui-kit";
import { AUDIT_GROUPS, auditLog, type AuditGroup } from "@/lib/server/contributors-view";
import { getProgramForMember } from "@/lib/server/queries";
import { getOwnerSession } from "@/lib/server/session";

export const metadata = { title: "Audit log" };

const GROUP_LABELS: Record<AuditGroup, string> = {
  program: "Program and vault",
  decisions: "Submissions and decisions",
  contributors: "People and wallets",
  rounds: "Rounds and payouts",
};

export default async function AuditPage({
  params,
  searchParams,
}: PageProps<"/app/programs/[id]/audit">) {
  const session = await getOwnerSession();
  if (!session) return null;
  const { id } = await params;
  const member = await getProgramForMember(id, session.sub);
  if (!member) return null;
  const explorer = chainConfig().explorerUrl;
  const verifyBase = member.program.status === "draft" ? null : `/p/${member.program.slug}`;
  const sp = await searchParams;
  const group =
    typeof sp.group === "string" && sp.group in AUDIT_GROUPS ? (sp.group as AuditGroup) : undefined;
  const actor =
    sp.actor === "agent" || sp.actor === "user" || sp.actor === "system" ? sp.actor : undefined;
  const rows = await auditLog(id, { group, actor, limit: 300 });
  const link = (g?: string, a?: string) => {
    const q = new URLSearchParams();
    if (g) q.set("group", g);
    if (a) q.set("actor", a);
    return `?${q}`;
  };
  const chip = (active: boolean) =>
    `rounded-md border px-2.5 py-1 ${active ? "bg-secondary text-foreground border-foreground/20" : "text-muted-foreground hover:text-foreground"}`;

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Audit log"
        description="Every action by the agent, the team and contributors, in order. Entries can't be edited or deleted, even directly in the database."
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <a href={`/api/owner/programs/${id}/audit?format=csv`}>Export CSV</a>
            </Button>
            <Button asChild variant="outline" size="sm">
              <a href={`/api/owner/programs/${id}/audit?format=json`}>Export JSON</a>
            </Button>
          </>
        }
      />
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-[13px]">
        <nav aria-label="Filter by kind" className="flex flex-wrap gap-1">
          <Link href={link(undefined, actor)} className={chip(!group)} scroll={false}>
            Everything
          </Link>
          {(Object.keys(GROUP_LABELS) as AuditGroup[]).map((g) => (
            <Link
              key={g}
              href={link(g, actor)}
              className={chip(group === g)}
              scroll={false}
              aria-current={group === g ? "page" : undefined}
            >
              {GROUP_LABELS[g]}
            </Link>
          ))}
        </nav>
        <nav aria-label="Filter by actor" className="flex flex-wrap gap-1">
          {([undefined, "agent", "user", "system"] as const).map((a) => (
            <Link
              key={a ?? "all"}
              href={link(group, a)}
              className={chip(actor === a)}
              scroll={false}
            >
              {a === undefined
                ? "Anyone"
                : a === "user"
                  ? "People"
                  : a === "agent"
                    ? "Agent"
                    : "System"}
            </Link>
          ))}
        </nav>
      </div>
      {rows.length === 0 ? (
        <EmptyState>No events match these filters.</EmptyState>
      ) : (
        <TableFrame>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When (UTC)</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="mono-num text-muted-foreground whitespace-nowrap">
                    {r.createdAt.toISOString().slice(0, 19).replace("T", " ")}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {r.actor === "agent" ? "Agent" : r.actor === "system" ? "System" : "Person"}
                  </TableCell>
                  <TableCell className="font-mono text-[12px] whitespace-nowrap">
                    {r.action}
                  </TableCell>
                  <TableCell className="max-w-[640px] text-[13px] whitespace-normal">
                    <AuditDetails data={r.dataJson} explorer={explorer} verifyBase={verifyBase} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableFrame>
      )}
    </div>
  );
}
