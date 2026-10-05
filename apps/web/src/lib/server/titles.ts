import "server-only";
import { cache } from "react";
import { z } from "zod";
import { getDb, rounds } from "@misthos/db";
import { and, eq } from "drizzle-orm";
import { getProgramForMember } from "./queries";
import { getOwnerSession } from "./session";

/** The program's name for tab titles, only for its members (never leaks a program's existence). */
export const programNameForTitle = cache(async (id: string): Promise<string | null> => {
  if (!z.uuid().safeParse(id).success) return null;
  const session = await getOwnerSession();
  if (!session) return null;
  return (await getProgramForMember(id, session.sub))?.program.name ?? null;
});

/** A round's number for its tab title. Call only after programNameForTitle confirmed membership. */
export const roundNumber = cache(
  async (programId: string, roundId: string): Promise<number | null> => {
    const [r] = await getDb()
      .select({ number: rounds.number })
      .from(rounds)
      .where(and(eq(rounds.id, roundId), eq(rounds.programId, programId)))
      .limit(1);
    return r?.number ?? null;
  },
);
