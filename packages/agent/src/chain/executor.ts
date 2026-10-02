import { keccak256, toBytes, type Address, type Hex } from "viem";

/** Sends a contract call as the agent and waits for it to land. Circle SCA in production; EOA as fallback. */
export interface AgentExecutor {
  kind: "circle-sca" | "eoa";
  address: Address;
  /**
   * Idempotent: the same `idempotencyKey` never produces two transactions (Circle dedupes by key; the EOA executor
   * remembers keys it sent). Callers also check chain state before sending.
   */
  send(call: {
    to: Address;
    data: Hex;
    idempotencyKey: string;
    label: string;
  }): Promise<{ txHash: Hex }>;
}

export class ChainError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ChainError";
  }
}

/** Deterministic RFC-4122-shaped UUID (v4 layout) from any seed, for Circle idempotency keys. */
export function idempotencyUuid(seed: string): string {
  const h = keccak256(toBytes(seed)).slice(2);
  const v = (parseInt(h[16]!, 16) & 0x3) | 0x8;
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${v.toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
