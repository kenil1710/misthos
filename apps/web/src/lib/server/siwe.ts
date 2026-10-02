import { verifyWalletSignature } from "@misthos/shared";
import type { Hex, PublicClient } from "viem";
import { parseSiweMessage } from "viem/siwe";

export type SiweResult =
  | { ok: true; address: `0x${string}` }
  | {
      ok: false;
      error:
        | "malformed"
        | "wrong_domain"
        | "wrong_uri"
        | "wrong_chain"
        | "stale"
        | "bad_signature"
        | "nonce_used";
    };

const MAX_AGE_MS = 10 * 60 * 1000;
const CLOCK_SKEW_MS = 60 * 1000;

/**
 * Verify an EIP-4361 sign-in. Order matters: cheap structural checks, then the signature (EOA or ERC-1271),
 * and only then consume the single-use nonce, so a forged request can't burn a legitimate user's nonce.
 */
export async function verifySiwe(input: {
  message: string;
  signature: Hex;
  expectedOrigin: string;
  expectedChainId: number;
  client: Pick<PublicClient, "verifyMessage">;
  consumeNonce: (nonce: string) => Promise<boolean>;
  now?: Date;
}): Promise<SiweResult> {
  const now = input.now ?? new Date();
  let parsed;
  try {
    parsed = parseSiweMessage(input.message);
  } catch {
    return { ok: false, error: "malformed" };
  }
  const { address, domain, uri, chainId, nonce, issuedAt, expirationTime, notBefore } = parsed;
  if (!address || !domain || !uri || !chainId || !nonce || !issuedAt)
    return { ok: false, error: "malformed" };

  const origin = new URL(input.expectedOrigin);
  if (domain !== origin.host) return { ok: false, error: "wrong_domain" };
  let uriOrigin: string;
  try {
    uriOrigin = new URL(uri).origin;
  } catch {
    return { ok: false, error: "wrong_uri" };
  }
  if (uriOrigin !== origin.origin) return { ok: false, error: "wrong_uri" };
  if (chainId !== input.expectedChainId) return { ok: false, error: "wrong_chain" };

  const t = now.getTime();
  if (issuedAt.getTime() > t + CLOCK_SKEW_MS || t - issuedAt.getTime() > MAX_AGE_MS)
    return { ok: false, error: "stale" };
  if (expirationTime && expirationTime.getTime() <= t) return { ok: false, error: "stale" };
  if (notBefore && notBefore.getTime() > t + CLOCK_SKEW_MS) return { ok: false, error: "stale" };

  const valid = await verifyWalletSignature(input.client, {
    address,
    message: input.message,
    signature: input.signature,
  });
  if (!valid) return { ok: false, error: "bad_signature" };
  if (!(await input.consumeNonce(nonce))) return { ok: false, error: "nonce_used" };
  return { ok: true, address: address.toLowerCase() as `0x${string}` };
}
