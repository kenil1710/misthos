import { contributors, programs, users, type DbLike } from "@misthos/db";
import { buildWalletLinkMessage } from "@misthos/shared";
import { and, eq } from "drizzle-orm";
import type { Hex } from "viem";
import { minimumStatus } from "@/lib/minimums";
import { audit } from "./audit";

export type LinkWalletError =
  | "program_not_found"
  | "program_not_open"
  | "stale"
  | "bad_signature"
  | "nonce_used"
  | "wallet_in_use"
  | "below_minimum"
  | "minimum_unknown";

export type LinkWalletResult =
  | { ok: true; contributorId: string; joined: boolean; walletChanged: boolean }
  | { ok: false; error: LinkWalletError };

const MAX_AGE_MS = 10 * 60 * 1000;

/**
 * Join a program (or change payout wallet) with a signed ownership proof. The message is rebuilt server-side from
 * trusted data, so the client can't get a different text past verification. Changing an existing wallet records
 * wallet_changed_at, which the vault's payee cooldown and the WALLET_CHANGED_RECENTLY flag both key off.
 */
export async function linkContributorWallet(
  db: DbLike,
  p: {
    programSlug: string;
    user: { id: string; xUserId: string; xHandle: string };
    address: string;
    /** Ignored: GitHub is only linked through "Connect GitHub" (OAuth). Kept so old clients don't break. */
    githubLogin?: string | null;
    nonce: string;
    issuedAt: Date;
    signature: Hex;
    chainId: number;
    verify: (args: { address: `0x${string}`; message: string; signature: Hex }) => Promise<boolean>;
    consumeNonce: (nonce: string, userId: string) => Promise<boolean>;
    now?: Date;
  },
): Promise<LinkWalletResult> {
  const now = p.now ?? new Date();
  const [program] = await db
    .select({
      id: programs.id,
      slug: programs.slug,
      name: programs.name,
      status: programs.status,
      minXFollowers: programs.minXFollowers,
      minAccountAgeDays: programs.minAccountAgeDays,
      belowMinimum: programs.belowMinimum,
    })
    .from(programs)
    .where(eq(programs.slug, p.programSlug))
    .limit(1);
  if (!program) return { ok: false, error: "program_not_found" };
  if (program.status !== "active") return { ok: false, error: "program_not_open" };
  // "Can't join": accounts below the minimums are turned away before they join (members can still change wallet).
  if (program.belowMinimum === "block") {
    const [member] = await db
      .select({ id: contributors.id })
      .from(contributors)
      .where(and(eq(contributors.programId, program.id), eq(contributors.xUserId, p.user.xUserId)))
      .limit(1);
    if (!member) {
      const [u] = await db
        .select({ followers: users.xFollowers, createdAt: users.xCreatedAt })
        .from(users)
        .where(eq(users.id, p.user.id))
        .limit(1);
      const m = minimumStatus(program, u ?? { followers: null, createdAt: null }, now);
      if (m.below) return { ok: false, error: "below_minimum" };
      // Unknown numbers (signed in with X before follower counts were saved) are never let through here.
      if (m.followers?.ok === null || m.age?.ok === null)
        return { ok: false, error: "minimum_unknown" };
    }
  }
  if (
    now.getTime() - p.issuedAt.getTime() > MAX_AGE_MS ||
    p.issuedAt.getTime() > now.getTime() + 60_000
  ) {
    return { ok: false, error: "stale" };
  }

  const address = p.address.toLowerCase() as `0x${string}`;
  const message = buildWalletLinkMessage({
    programSlug: program.slug,
    programName: program.name,
    xHandle: p.user.xHandle,
    xUserId: p.user.xUserId,
    address,
    chainId: p.chainId,
    nonce: p.nonce,
    issuedAt: p.issuedAt,
  });
  if (!(await p.verify({ address, message, signature: p.signature })))
    return { ok: false, error: "bad_signature" };
  if (!(await p.consumeNonce(p.nonce, p.user.id))) return { ok: false, error: "nonce_used" };

  try {
    return await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(contributors)
        .where(
          and(eq(contributors.programId, program.id), eq(contributors.xUserId, p.user.xUserId)),
        )
        .limit(1);
      const proof = {
        walletProofMessage: message,
        walletProofSignature: p.signature,
        walletVerifiedAt: now,
      };

      if (!existing) {
        // GitHub identity only ever comes from the user's verified OAuth connection, never from typed input.
        const [u] = await tx
          .select({
            ghId: users.githubUserId,
            ghLogin: users.githubLogin,
            ghAt: users.githubVerifiedAt,
          })
          .from(users)
          .where(eq(users.id, p.user.id))
          .limit(1);
        const [c] = await tx
          .insert(contributors)
          .values({
            programId: program.id,
            userId: p.user.id,
            xUserId: p.user.xUserId,
            xHandle: p.user.xHandle,
            githubLogin: u?.ghLogin ?? null,
            githubUserId: u?.ghId ?? null,
            githubVerifiedAt: u?.ghAt ?? null,
            walletAddress: address,
            ...proof,
          })
          .returning({ id: contributors.id });
        await audit(tx, {
          programId: program.id,
          actor: `user:${p.user.id}`,
          action: "contributor.joined",
          entity: "contributor",
          entityId: c!.id,
          data: { xHandle: p.user.xHandle, wallet: address, githubLogin: u?.ghLogin ?? null },
        });
        return { ok: true as const, contributorId: c!.id, joined: true, walletChanged: false };
      }

      const walletChanged = existing.walletAddress !== null && existing.walletAddress !== address;
      await tx
        .update(contributors)
        .set({
          walletAddress: address,
          xHandle: p.user.xHandle,
          ...proof,
          ...(walletChanged ? { walletChangedAt: now } : {}),
        })
        .where(eq(contributors.id, existing.id));
      await audit(tx, {
        programId: program.id,
        actor: `user:${p.user.id}`,
        action: walletChanged ? "contributor.wallet_changed" : "contributor.wallet_verified",
        entity: "contributor",
        entityId: existing.id,
        data: { from: existing.walletAddress, to: address },
      });
      return { ok: true as const, contributorId: existing.id, joined: false, walletChanged };
    });
  } catch (e) {
    if (String((e as { cause?: unknown }).cause ?? e).includes("contributors_program_wallet_uq")) {
      return { ok: false, error: "wallet_in_use" };
    }
    throw e;
  }
}

/** Upsert the X identity after OAuth. Handle changes are tracked; the numeric X id is the stable key. */
export async function upsertXUser(
  db: DbLike,
  x: { id: string; username: string; name?: string; createdAt?: Date; followers?: number },
): Promise<{ id: string; xUserId: string; xHandle: string }> {
  const [u] = await db
    .insert(users)
    .values({
      xUserId: x.id,
      xHandle: x.username,
      name: x.name ?? null,
      xCreatedAt: x.createdAt ?? null,
      xFollowers: x.followers ?? null,
    })
    .onConflictDoUpdate({
      target: users.xUserId,
      set: {
        xHandle: x.username,
        name: x.name ?? null,
        xCreatedAt: x.createdAt ?? null,
        xFollowers: x.followers ?? null,
      },
    })
    .returning({ id: users.id, xUserId: users.xUserId, xHandle: users.xHandle });
  return { id: u!.id, xUserId: u!.xUserId!, xHandle: u!.xHandle! };
}

export async function upsertWalletUser(
  db: DbLike,
  address: string,
): Promise<{ id: string; isFounder: boolean }> {
  const walletAddress = address.toLowerCase();
  const [u] = await db
    .insert(users)
    .values({ walletAddress })
    .onConflictDoUpdate({ target: users.walletAddress, set: { walletAddress } })
    .returning({ id: users.id, isFounder: users.isFounder });
  return u!;
}
