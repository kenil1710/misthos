import { canonicalize, type SourceType } from "@misthos/shared";
import { keccak256, toBytes, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Flag } from "./types";

export const RECORD_SCHEMA = "misthos.decision/v1";

/** Signs decision hashes. EOA now; a Circle smart-contract wallet signer plugs in behind the same interface. */
export interface AgentSigner {
  kind: "eoa" | "erc1271";
  address: Address;
  /** EIP-191 personal_sign over the raw 32-byte decision hash. */
  signHash(hash: Hex): Promise<Hex>;
}

/** Testnet-only signer from AGENT_PRIVATE_KEY. */
export function eoaSigner(privateKey: Hex): AgentSigner {
  const account = privateKeyToAccount(privateKey);
  return {
    kind: "eoa",
    address: account.address,
    signHash: (hash) => account.signMessage({ message: { raw: hash } }),
  };
}

export interface DecisionRecord {
  schema: typeof RECORD_SCHEMA;
  chainId: number;
  program: { id: string; slug: string };
  submission: {
    id: string;
    url: string;
    sourceType: SourceType;
    resourceId: string;
    submittedAt: string;
  };
  contributor: {
    id: string;
    xUserId: string;
    xHandle: string;
    githubLogin: string | null;
    wallet: string | null;
  };
  round: { id: string; number: number; startsAt: string; endsAt: string };
  /** keccak256 of the canonical inputs the decision depended on (submission, contributor, round, program rules). */
  inputHash: Hex;
  /** keccak256 of the exact content text that was evaluated (null if it couldn't be fetched). */
  contentHash: Hex | null;
  /** The program context (version and hash) the work was judged against; null if the program had none. */
  context?: { version: number; hash: Hex } | null;
  flags: Flag[];
  judgment: { model: string; promptVersion: string; output: unknown } | null;
  ruleVersion: string;
  rule: string;
  decision: {
    action: string;
    categoryKey: string | null;
    points: string | null;
    amount: string;
    auto: boolean;
  };
  /** A re-processed agent decision names the decision it replaces and why; first decisions carry neither. */
  decidedBy:
    | { type: "agent"; supersedes?: Hex; reason?: string }
    | { type: "human"; userId: string; reason: string; supersedes: Hex };
  summary: string;
  decidedAt: string;
  signer: Address;
}

export interface SignedRecord {
  record: DecisionRecord;
  decisionJson: string;
  decisionHash: Hex;
  signature: Hex;
}

/** Canonicalize → keccak256 → sign. The signer address is inside the hashed record. */
export async function signRecord(
  record: Omit<DecisionRecord, "signer">,
  signer: AgentSigner,
): Promise<SignedRecord> {
  const full: DecisionRecord = { ...record, signer: signer.address };
  const decisionJson = canonicalize(full);
  const decisionHash = keccak256(toBytes(decisionJson));
  return {
    record: full,
    decisionJson,
    decisionHash,
    signature: await signer.signHash(decisionHash),
  };
}
