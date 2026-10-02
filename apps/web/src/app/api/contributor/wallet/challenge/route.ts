import { getDb, programs } from "@misthos/db";
import { buildWalletLinkMessage, EvmAddress, Slug } from "@misthos/shared";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { chainConfig } from "@/lib/server/chain";
import { jsonError, readJson, sameOrigin } from "@/lib/server/http";
import { issueNonce } from "@/lib/server/nonces";
import { getContributorSession } from "@/lib/server/session";

const Body = z.object({ programSlug: Slug, address: EvmAddress });

/** Issue the exact message the contributor's wallet must sign. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return jsonError("bad_origin", 403);
  const session = await getContributorSession();
  if (!session) return jsonError("sign_in_required", 401);
  const body = Body.safeParse(await readJson(req));
  if (!body.success) return jsonError("invalid_body", 400);

  const [program] = await getDb()
    .select({ slug: programs.slug, name: programs.name, status: programs.status })
    .from(programs)
    .where(eq(programs.slug, body.data.programSlug))
    .limit(1);
  if (!program) return jsonError("program_not_found", 404);
  if (program.status !== "active") return jsonError("program_not_open", 409);

  const { nonce } = await issueNonce("wallet_link", session.sub);
  const issuedAt = new Date();
  const message = buildWalletLinkMessage({
    programSlug: program.slug,
    programName: program.name,
    xHandle: session.xh,
    xUserId: session.xid,
    address: body.data.address,
    chainId: chainConfig().chain.id,
    nonce,
    issuedAt,
  });
  return Response.json(
    { message, nonce, issuedAt: issuedAt.toISOString() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
