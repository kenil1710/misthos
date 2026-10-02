import "server-only";
import { contributors, users, type DbLike } from "@misthos/db";
import { and, eq, ne } from "drizzle-orm";
import { audit } from "./audit";

export type ConnectResult =
  { ok: true; programs: string[] } | { ok: false; error: "github_in_use" };

/**
 * Attach a verified GitHub account to a contributor's user and every program they've joined. One GitHub account per
 * Misthos user: an account already connected elsewhere is refused (stops farming one GitHub across X accounts).
 */
export async function connectGithub(
  db: DbLike,
  p: { userId: string; github: { id: number; login: string }; now?: Date },
): Promise<ConnectResult> {
  const id = String(p.github.id);
  const now = p.now ?? new Date();
  const [taken] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.githubUserId, id), ne(users.id, p.userId)))
    .limit(1);
  if (taken) return { ok: false, error: "github_in_use" };
  await db
    .update(users)
    .set({ githubUserId: id, githubLogin: p.github.login, githubVerifiedAt: now })
    .where(eq(users.id, p.userId));
  const rows = await db
    .update(contributors)
    .set({ githubUserId: id, githubLogin: p.github.login, githubVerifiedAt: now })
    .where(eq(contributors.userId, p.userId))
    .returning({ id: contributors.id, programId: contributors.programId });
  for (const r of rows)
    await audit(db, {
      programId: r.programId,
      actor: `user:${p.userId}`,
      action: "contributor.github_connected",
      entity: "contributor",
      entityId: r.id,
      data: { githubLogin: p.github.login, githubUserId: id },
    });
  return { ok: true, programs: rows.map((r) => r.programId) };
}
