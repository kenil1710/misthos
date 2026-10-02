import {
  keccak256,
  toBytes,
  type Address,
  type Hex,
  type PublicClient,
  type SignableMessage,
} from "viem";

/**
 * Verify an EIP-191 personal_sign signature for either an EOA or a smart-contract wallet.
 *
 * viem's verifyMessage runs the ERC-6492 universal validator via eth_call: it ecrecovers for EOAs and calls
 * `isValidSignature` (ERC-1271) for deployed contract wallets such as Circle SCAs, falling back to local ecrecover
 * if the call fails. Used for wallet-link proofs, owner sign-in, and decision-record signatures.
 */
export async function verifyWalletSignature(
  client: Pick<PublicClient, "verifyMessage">,
  params: { address: Address; message: SignableMessage; signature: Hex },
): Promise<boolean> {
  try {
    return await client.verifyMessage(params);
  } catch {
    return false;
  }
}

export type DecisionVerification =
  { ok: true } | { ok: false; error: "hash_mismatch" | "bad_signature" };

/**
 * Check a published decision record: re-hash the canonical JSON exactly as published, compare to the claimed
 * decisionHash, then verify the agent's EIP-191 signature over the raw 32-byte hash (EOA or ERC-1271).
 */
export async function verifyDecisionRecord(
  client: Pick<PublicClient, "verifyMessage">,
  record: { decisionJson: string; decisionHash: Hex; signature: Hex; signerAddress: Address },
): Promise<DecisionVerification> {
  if (keccak256(toBytes(record.decisionJson)) !== record.decisionHash.toLowerCase()) {
    return { ok: false, error: "hash_mismatch" };
  }
  const valid = await verifyWalletSignature(client, {
    address: record.signerAddress,
    message: { raw: record.decisionHash },
    signature: record.signature,
  });
  return valid ? { ok: true } : { ok: false, error: "bad_signature" };
}
