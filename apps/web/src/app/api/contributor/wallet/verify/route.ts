import { getDb } from "@misthos/db";
import { EvmAddress, GithubLogin, QUEUES, Slug, verifyWalletSignature } from "@misthos/shared";
import { z } from "zod";
import { chainConfig, publicClient } from "@/lib/server/chain";
import { linkContributorWallet } from "@/lib/server/contributors";
import { jsonError, readJson, sameOrigin } from "@/lib/server/http";
import { consumeNonce } from "@/lib/server/nonces";
import { enqueue } from "@/lib/server/queue";
import { getContributorSession } from "@/lib/server/session";

const Body = z.object({
  programSlug: Slug,
  address: EvmAddress,
  nonce: z.string().regex(/^[0-9a-f]{32}$/),
  issuedAt: z.iso.datetime(),
  signature: z
    .string()
    .regex(/^0x[0-9a-fA-F]+$/)
    .max(20_000),
  githubLogin: z.union([z.literal(""), GithubLogin]).optional(),
});

const STATUS: Record<string, number> = {
  program_not_found: 404,
  program_not_open: 409,
  stale: 400,
  bad_signature: 401,
  nonce_used: 409,
  wallet_in_use: 409,
};

export async function POST(req: Request) {
  if (!sameOrigin(req)) return jsonError("bad_origin", 403);
  const session = await getContributorSession();
  if (!session) return jsonError("sign_in_required", 401);
  const body = Body.safeParse(await readJson(req));
  if (!body.success) return jsonError("invalid_body", 400);
  const b = body.data;

  const result = await linkContributorWallet(getDb(), {
    programSlug: b.programSlug,
    user: { id: session.sub, xUserId: session.xid, xHandle: session.xh },
    address: b.address,
    githubLogin: b.githubLogin === undefined ? undefined : b.githubLogin || null,
    nonce: b.nonce,
    issuedAt: new Date(b.issuedAt),
    signature: b.signature as `0x${string}`,
    chainId: chainConfig().chain.id,
    verify: (args) => verifyWalletSignature(publicClient(), args),
    consumeNonce: (n, userId) => consumeNonce(n, "wallet_link", userId),
  });
  if (!result.ok) return jsonError(result.error, STATUS[result.error] ?? 400);
  // Register (or update) the payee in the program's vault; the contract's cooldown starts on-chain.
  await enqueue(
    QUEUES.syncPayee,
    { contributorId: result.contributorId },
    `payee:${result.contributorId}:${b.address.toLowerCase()}`,
  );
  return Response.json(result);
}
