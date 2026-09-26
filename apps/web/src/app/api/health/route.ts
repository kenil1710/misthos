import { getChainConfig } from "@misthos/shared";

export function GET() {
  const chain = getChainConfig();
  return Response.json({ ok: true, chain: chain.key, chainId: chain.chain.id });
}
