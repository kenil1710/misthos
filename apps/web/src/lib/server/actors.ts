import "server-only";
import { getDb, users } from "@misthos/db";
import { shortHex } from "@misthos/shared";
import { inArray } from "drizzle-orm";

/** "user:<id>" actors → "@handle", "0x12…34" or "You"; other actors keep a readable name. */
export async function actorNames(actors: string[], me: string): Promise<Map<string, string>> {
  const ids = [...new Set(actors.filter((a) => a.startsWith("user:")).map((a) => a.slice(5)))];
  const out = new Map<string, string>();
  if (!ids.length) return out;
  const rows = await getDb()
    .select({ id: users.id, wallet: users.walletAddress, handle: users.xHandle })
    .from(users)
    .where(inArray(users.id, ids));
  for (const u of rows)
    out.set(
      `user:${u.id}`,
      u.id === me ? "You" : u.handle ? `@${u.handle}` : u.wallet ? shortHex(u.wallet) : "Someone",
    );
  return out;
}

export function actorFallback(actor: string): string {
  if (actor === "agent") return "Agent";
  if (actor === "system") return "System";
  if (actor.startsWith("support:")) return "Misthos support";
  return "Someone";
}
