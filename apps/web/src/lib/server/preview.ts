import "server-only";
import { Slug } from "@misthos/shared";
import { getProgramBySlug, getProgramForMember } from "./queries";
import { getOwnerSession } from "./session";

/**
 * An unpublished program's public pages, for its own team only. Everyone else still gets a 404, so a draft never
 * leaks. Owners often open their join or audit link before publishing; this shows them the page with a notice
 * instead of "Page not found".
 */
export async function draftPreviewFor(slug: string) {
  const parsed = Slug.safeParse(slug);
  if (!parsed.success) return null;
  const session = await getOwnerSession();
  if (!session) return null;
  const program = await getProgramBySlug(parsed.data);
  if (!program || program.status === "active" || program.status === "paused") return null;
  return (await getProgramForMember(program.id, session.sub)) ? program : null;
}
