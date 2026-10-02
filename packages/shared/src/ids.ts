import { concat, encodeAbiParameters, keccak256, toBytes, type Hex } from "viem";

/**
 * On-chain identifiers, all derived deterministically from database UUIDs so any retry or reviewer can recompute
 * them. payoutId follows PROMPT §6.2: keccak256(programId, roundId, contributorId) over ABI-encoded bytes32 values.
 */
export const programIdBytes32 = (programId: string): Hex =>
  keccak256(toBytes(`misthos:program:${programId}`));
export const roundIdBytes32 = (roundId: string): Hex =>
  keccak256(toBytes(`misthos:round:${roundId}`));
export const contributorIdBytes32 = (contributorId: string): Hex =>
  keccak256(toBytes(`misthos:contributor:${contributorId}`));

export function payoutIdFor(programId: Hex, roundId: Hex, contributorId: Hex): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }],
      [programId, roundId, contributorId],
    ),
  );
}

/** keccak256 over the sorted 32-byte hashes, concatenated. Used for a payout's decisionHash and the round's root. */
export function hashOfHashes(hashes: Hex[]): Hex {
  const sorted = [...hashes].map((h) => h.toLowerCase() as Hex).sort();
  return keccak256(sorted.length ? concat(sorted) : "0x");
}
