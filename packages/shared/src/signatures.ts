import type { Address, Hex, PublicClient } from "viem";

/**
 * Verify an EIP-191 personal_sign signature for either an EOA or a smart-contract wallet.
 *
 * viem's verifyMessage runs the ERC-6492 universal validator via eth_call: it ecrecovers for EOAs and calls
 * `isValidSignature` (ERC-1271) for deployed contract wallets such as Circle SCAs, falling back to local ecrecover
 * if the call fails. Used for wallet-link proofs, owner sign-in, and decision-record signatures.
 */
export async function verifyWalletSignature(
  client: Pick<PublicClient, "verifyMessage">,
  params: { address: Address; message: string; signature: Hex },
): Promise<boolean> {
  try {
    return await client.verifyMessage(params);
  } catch {
    return false;
  }
}
