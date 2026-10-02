import { contributors, decisions, fetchedResources, getDb, submissions } from "@misthos/db";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { jsonError } from "@/lib/server/http";
import { getMembership } from "@/lib/server/programs";
import { getOwnerSession } from "@/lib/server/session";

/** Everything a reviewer needs for one submission. Members only; 404 (not 403) for everyone else. */
export async function GET(_req: Request, ctx: RouteContext<"/api/owner/submissions/[id]">) {
  const session = await getOwnerSession();
  if (!session) return jsonError("sign_in_required", 401);
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return jsonError("not_found", 404);
  const db = getDb();
  const [row] = await db
    .select({ s: submissions, c: contributors })
    .from(submissions)
    .innerJoin(contributors, eq(contributors.id, submissions.contributorId))
    .where(eq(submissions.id, id))
    .limit(1);
  if (!row || !(await getMembership(db, row.s.programId, session.sub)))
    return jsonError("not_found", 404);

  const [resource] = await db
    .select({ text: fetchedResources.contentText, payload: fetchedResources.payloadJson })
    .from(fetchedResources)
    .where(
      and(
        eq(fetchedResources.sourceType, row.s.sourceType),
        eq(fetchedResources.resourceId, row.s.resourceId),
      ),
    )
    .limit(1);
  const history = await db
    .select()
    .from(decisions)
    .where(eq(decisions.submissionId, id))
    .orderBy(desc(decisions.createdAt));
  const payload = resource?.payload as
    | { title?: string | null; timestamp?: string | null; author?: { handle?: string | null } }
    | undefined;

  return Response.json(
    {
      submission: {
        id: row.s.id,
        url: row.s.url,
        sourceType: row.s.sourceType,
        status: row.s.status,
        amount: row.s.amount?.toString() ?? null,
        createdAt: row.s.createdAt.toISOString(),
        lastError: row.s.lastError,
      },
      contributor: {
        xHandle: row.c.xHandle,
        githubLogin: row.c.githubLogin,
        wallet: row.c.walletAddress,
      },
      content: resource
        ? {
            title: payload?.title ?? null,
            author: payload?.author?.handle ?? null,
            timestamp: payload?.timestamp ?? null,
            text: resource.text.slice(0, 6000),
            truncated: resource.text.length > 6000,
          }
        : null,
      decisions: history.map((d) => ({
        id: d.id,
        action: d.action,
        amount: d.amount.toString(),
        points: d.points,
        categoryKey: d.categoryKey,
        summary: d.summary,
        flags: d.flagsJson,
        llm: d.llmOutputJson,
        model: d.model,
        promptVersion: d.promptVersion,
        ruleVersion: d.ruleVersion,
        decidedBy: d.decidedBy,
        overrideReason: d.overrideReason,
        decisionHash: d.decisionHash,
        signerAddress: d.signerAddress,
        createdAt: d.createdAt.toISOString(),
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
