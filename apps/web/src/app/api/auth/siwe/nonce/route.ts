import { issueNonce } from "@/lib/server/nonces";
import { jsonError, sameOrigin } from "@/lib/server/http";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return jsonError("bad_origin", 403);
  const { nonce } = await issueNonce("siwe");
  return Response.json({ nonce }, { headers: { "Cache-Control": "no-store" } });
}
