import "server-only";
import { getDb, users } from "@misthos/db";
import { eq } from "drizzle-orm";
import type { OwnerSession } from "./session";

/** Founders: wallets listed in FOUNDER_WALLETS (comma-separated), or users flagged is_founder. */
export async function isFounder(session: OwnerSession | null): Promise<boolean> {
  if (!session) return false;
  const list = (process.env.FOUNDER_WALLETS ?? "")
    .split(",")
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean);
  if (list.includes(session.addr.toLowerCase())) return true;
  const [u] = await getDb()
    .select({ f: users.isFounder })
    .from(users)
    .where(eq(users.id, session.sub))
    .limit(1);
  return u?.f ?? false;
}
