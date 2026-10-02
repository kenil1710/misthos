import { getDb } from "@misthos/db";
import { type NextRequest } from "next/server";
import { z } from "zod";
import { jsonError } from "@/lib/server/http";
import { getMembership } from "@/lib/server/programs";
import { auditLog } from "@/lib/server/contributors-view";
import { getOwnerSession } from "@/lib/server/session";

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v);
  // Quote everything and neutralize spreadsheet formulas.
  return `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
};

/** Export the full append-only audit log as CSV or JSON (members only). */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/owner/programs/[id]/audit">) {
  const session = await getOwnerSession();
  if (!session) return jsonError("sign_in_required", 401);
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success || !(await getMembership(getDb(), id, session.sub)))
    return jsonError("not_found", 404);
  const format = req.nextUrl.searchParams.get("format") === "csv" ? "csv" : "json";
  const rows = await auditLog(id, { limit: 100_000 });
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === "json") {
    return new Response(
      JSON.stringify(
        rows.map((r) => ({
          id: r.id,
          at: r.createdAt.toISOString(),
          actor: r.actor,
          action: r.action,
          entity: r.entity,
          entityId: r.entityId,
          data: r.dataJson,
        })),
        null,
        2,
      ),
      {
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition": `attachment; filename="misthos-audit-${stamp}.json"`,
          "Cache-Control": "no-store",
        },
      },
    );
  }
  const header = ["id", "at", "actor", "action", "entity", "entity_id", "data"].join(",");
  const body = rows
    .map((r) =>
      [r.id, r.createdAt.toISOString(), r.actor, r.action, r.entity, r.entityId, r.dataJson]
        .map(csvCell)
        .join(","),
    )
    .join("\n");
  return new Response(`${header}\n${body}\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="misthos-audit-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
