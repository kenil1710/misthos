import "server-only";
import { cache } from "react";
import { z } from "zod";
import { getProgramForMember } from "./queries";
import { getOwnerSession } from "./session";

/** The program's name for tab titles, only for its members (never leaks a program's existence). */
export const programNameForTitle = cache(async (id: string): Promise<string | null> => {
  if (!z.uuid().safeParse(id).success) return null;
  const session = await getOwnerSession();
  if (!session) return null;
  return (await getProgramForMember(id, session.sub))?.program.name ?? null;
});
