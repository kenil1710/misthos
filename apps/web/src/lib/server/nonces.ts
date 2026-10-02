import "server-only";
import { authNonces, getDb } from "@misthos/db";
import { and, eq, gt, isNull, lt } from "drizzle-orm";
import { randomBytes } from "node:crypto";

const TTL_MS = 10 * 60 * 1000;

/** Alphanumeric (SIWE requires ≥8 alphanumeric chars). */
export function randomNonce(): string {
  return randomBytes(16).toString("hex");
}

export async function issueNonce(purpose: "siwe" | "wallet_link", userId?: string) {
  const db = getDb();
  const nonce = randomNonce();
  const expiresAt = new Date(Date.now() + TTL_MS);
  // Opportunistic cleanup of long-expired nonces keeps the table small.
  await db
    .delete(authNonces)
    .where(lt(authNonces.expiresAt, new Date(Date.now() - 24 * 3600 * 1000)));
  await db.insert(authNonces).values({ nonce, purpose, userId, expiresAt });
  return { nonce, expiresAt };
}

/**
 * Atomically mark a nonce used. Returns false if it doesn't exist, expired, was already used, has another
 * purpose, or (for wallet_link) belongs to a different user. Single UPDATE, so concurrent replays can't both win.
 */
export async function consumeNonce(
  nonce: string,
  purpose: "siwe" | "wallet_link",
  userId?: string,
): Promise<boolean> {
  const conditions = [
    eq(authNonces.nonce, nonce),
    eq(authNonces.purpose, purpose),
    isNull(authNonces.usedAt),
    gt(authNonces.expiresAt, new Date()),
  ];
  if (userId) conditions.push(eq(authNonces.userId, userId));
  const rows = await getDb()
    .update(authNonces)
    .set({ usedAt: new Date() })
    .where(and(...conditions))
    .returning({ nonce: authNonces.nonce });
  return rows.length === 1;
}
