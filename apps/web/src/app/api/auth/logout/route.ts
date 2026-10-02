import { z } from "zod";
import { jsonError, readJson, sameOrigin } from "@/lib/server/http";
import { endSession } from "@/lib/server/session";

const Body = z.object({ kind: z.enum(["owner", "contributor"]) });

export async function POST(req: Request) {
  if (!sameOrigin(req)) return jsonError("bad_origin", 403);
  const body = Body.safeParse(await readJson(req));
  if (!body.success) return jsonError("invalid_body", 400);
  await endSession(body.data.kind);
  return Response.json({ ok: true });
}
