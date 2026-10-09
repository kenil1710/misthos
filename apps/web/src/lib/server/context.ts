import { programContexts, programs, type DbLike } from "@misthos/db";
import {
  contextHash,
  contextInputHash,
  QUEUES,
  type ContextReadInput,
  type ContextSaveInput,
} from "@misthos/shared";
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { audit } from "./audit";

/**
 * Save a program's context for the agent as its next version and make it current. The understanding is whatever
 * the owner kept or edited; the sources come from the read request it started from (if the owner's own).
 */
export async function saveContext(
  db: DbLike,
  p: { programId: string; ownerUserId: string; input: ContextSaveInput },
) {
  const { input } = p;
  const sources = input.readId
    ? ((
        await db
          .select({ sources: programContexts.sourcesJson })
          .from(programContexts)
          .where(
            and(
              eq(programContexts.id, input.readId),
              eq(programContexts.ownerUserId, p.ownerUserId),
            ),
          )
          .limit(1)
      )[0]?.sources ?? [])
    : [];
  const [last] = await db
    .select({ v: sql<number>`coalesce(max(${programContexts.version}), 0)::int` })
    .from(programContexts)
    .where(and(eq(programContexts.programId, p.programId), isNotNull(programContexts.version)));
  const version = Number(last?.v ?? 0) + 1;
  const saved = {
    version,
    about: input.about,
    links: input.links,
    mustInclude: input.mustInclude,
    understanding: input.understanding,
  };
  const hash = contextHash(saved);
  await db.insert(programContexts).values({
    ownerUserId: p.ownerUserId,
    programId: p.programId,
    version,
    about: input.about,
    linksJson: input.links,
    mustIncludeJson: input.mustInclude,
    status: "ready",
    understandingJson: input.understanding,
    sourcesJson: sources,
    contextHash: hash,
    inputHash: contextInputHash(input),
  });
  await db.update(programs).set({ contextVersion: version }).where(eq(programs.id, p.programId));
  await audit(db, {
    programId: p.programId,
    actor: `user:${p.ownerUserId}`,
    action: "program.context_saved",
    entity: "program",
    entityId: p.programId,
    data: { version, contextHash: hash },
  });
  return { version, contextHash: hash };
}

/**
 * Ask the agent to read the owner's text and links. An identical read from the last day is reused (no fetch, no
 * model call); otherwise a read request is queued for the worker. Returns the request id to poll. Only real reads
 * with a result count as cached: a saved version (which may hold no understanding, or the owner's own edits) never
 * stands in for a read.
 */
export async function requestContextRead(
  db: DbLike,
  p: { ownerUserId: string; input: ContextReadInput },
  enqueue: (queue: string, data: object, key: string) => Promise<unknown>,
) {
  const inputHash = contextInputHash(p.input);
  const [cached] = await db
    .select({ id: programContexts.id })
    .from(programContexts)
    .where(
      and(
        eq(programContexts.inputHash, inputHash),
        eq(programContexts.ownerUserId, p.ownerUserId),
        eq(programContexts.status, "ready"),
        isNull(programContexts.version),
        isNotNull(programContexts.understandingJson),
        sql`${programContexts.updatedAt} > now() - interval '1 day'`,
      ),
    )
    .orderBy(desc(programContexts.updatedAt))
    .limit(1);
  if (cached) return { id: cached.id, cached: true };
  const [row] = await db
    .insert(programContexts)
    .values({
      ownerUserId: p.ownerUserId,
      about: p.input.about,
      linksJson: p.input.links,
      mustIncludeJson: p.input.mustInclude,
      status: "reading",
      inputHash,
    })
    .returning({ id: programContexts.id });
  await enqueue(QUEUES.readContext, { contextId: row!.id }, `context:${row!.id}`);
  return { id: row!.id, cached: false };
}
