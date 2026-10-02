import { and, eq, gte } from "drizzle-orm";
import type { DbLike } from "./client";
import { auditEvents, programs } from "./schema";

/**
 * Flag programs created at or after `since` as demo data (excluded from every public metric), with an audit event
 * per program. Idempotent: already-flagged programs are skipped.
 */
export async function markProgramsDemoSince(
  db: DbLike,
  since: Date,
): Promise<{ slug: string; createdAt: Date }[]> {
  return db.transaction(async (tx) => {
    const marked = await tx
      .update(programs)
      .set({ isDemo: true })
      .where(and(gte(programs.createdAt, since), eq(programs.isDemo, false)))
      .returning({ id: programs.id, slug: programs.slug, createdAt: programs.createdAt });
    for (const p of marked) {
      await tx.insert(auditEvents).values({
        programId: p.id,
        actor: "system",
        action: "program.marked_demo",
        entity: "program",
        entityId: p.id,
        dataJson: { since: since.toISOString(), reason: "owner test program" },
      });
    }
    return marked.map(({ slug, createdAt }) => ({ slug, createdAt }));
  });
}
