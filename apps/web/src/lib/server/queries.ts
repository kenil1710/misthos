import "server-only";
import { contributors, getDb, programMembers, programs, rounds } from "@misthos/db";
import { and, asc, desc, eq } from "drizzle-orm";

export async function listProgramsForUser(userId: string) {
  return getDb()
    .select({
      id: programs.id,
      slug: programs.slug,
      name: programs.name,
      status: programs.status,
      role: programMembers.role,
      createdAt: programs.createdAt,
    })
    .from(programMembers)
    .innerJoin(programs, eq(programs.id, programMembers.programId))
    .where(eq(programMembers.userId, userId))
    .orderBy(desc(programs.createdAt));
}

/** Program for a member (owner/reviewer), or null — callers must 404 on null, never leak existence. */
export async function getProgramForMember(programId: string, userId: string) {
  const [row] = await getDb()
    .select({ program: programs, role: programMembers.role })
    .from(programs)
    .innerJoin(
      programMembers,
      and(eq(programMembers.programId, programs.id), eq(programMembers.userId, userId)),
    )
    .where(eq(programs.id, programId))
    .limit(1);
  return row ?? null;
}

export async function getProgramBySlug(slug: string) {
  const [p] = await getDb().select().from(programs).where(eq(programs.slug, slug)).limit(1);
  return p ?? null;
}

export async function getRounds(programId: string) {
  return getDb()
    .select()
    .from(rounds)
    .where(eq(rounds.programId, programId))
    .orderBy(asc(rounds.number));
}

export async function listContributors(programId: string) {
  return getDb()
    .select()
    .from(contributors)
    .where(eq(contributors.programId, programId))
    .orderBy(desc(contributors.createdAt));
}

export async function getContributorMembership(programId: string, xUserId: string) {
  const [c] = await getDb()
    .select()
    .from(contributors)
    .where(and(eq(contributors.programId, programId), eq(contributors.xUserId, xUserId)))
    .limit(1);
  return c ?? null;
}
