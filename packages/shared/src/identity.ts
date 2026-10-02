import { z } from "zod";

/** GitHub username rules: 1–39 chars, alphanumeric or single hyphens, no leading/trailing hyphen. */
export const GithubLogin = z
  .string()
  .trim()
  .transform((s) => s.replace(/^@/, ""))
  .pipe(
    z.string().regex(/^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i, "Enter a valid GitHub username"),
  );

export const EvmAddress = z
  .string()
  .trim()
  .regex(/^0x[0-9a-fA-F]{40}$/, "Enter a valid wallet address");

export interface WalletLinkParams {
  programSlug: string;
  programName: string;
  xHandle: string;
  xUserId: string;
  address: string;
  chainId: number;
  nonce: string;
  issuedAt: Date;
}

/**
 * The exact text a contributor signs to prove they control the payout wallet. Every field that matters is in the
 * message, so a signature can't be replayed for another program, X account, wallet, or chain; the nonce is
 * single-use server-side.
 */
export function buildWalletLinkMessage(p: WalletLinkParams): string {
  return [
    `Misthos: link this wallet to receive payouts from ${p.programName}.`,
    "",
    `Program: ${p.programSlug}`,
    `X account: @${p.xHandle} (${p.xUserId})`,
    `Wallet: ${p.address.toLowerCase()}`,
    `Chain ID: ${p.chainId}`,
    `Nonce: ${p.nonce}`,
    `Issued at: ${p.issuedAt.toISOString()}`,
    "",
    "Signing is free and does not send a transaction.",
  ].join("\n");
}
