import { misthosVaultAbi } from "@misthos/shared";
import { decodeFunctionData, keccak256, toBytes, type Address, type Hex } from "viem";
import { ChainError, type AgentExecutor } from "../src/chain/executor";
import { ChainRoundStatus, type VaultLimits, type VaultReader } from "../src/rounds/vault";

/**
 * In-memory model of MisthosVault's rules (the parts the round job touches), driven by the job's real calldata.
 * Reverts become ChainError(retryable=false), like a failed Circle transaction.
 */
export class FakeVault implements VaultReader, AgentExecutor {
  kind = "circle-sca" as const;
  address = "0x00000000000000000000000000000000000a6e47" as Address;
  time = 1_800_000_000n;
  payees = new Map<Hex, { wallet: Address; payableAfter: bigint }>();
  rounds = new Map<
    Hex,
    {
      status: number;
      total: bigint;
      payouts: { payoutId: Hex; contributorId: Hex; to: Address; amount: bigint }[];
    }
  >();
  paidIds = new Set<Hex>();
  balances = new Map<string, bigint>();
  sentKeys = new Map<string, Hex>();
  calls: string[] = [];
  /** Throw a retryable error on the next N sends (simulates a Circle/RPC hiccup). */
  failNext = 0;
  /** Recipients the token refuses (USDC-style blocklist): a transfer to them reverts the whole executeRound. */
  blocked = new Set<string>();
  /** executeRound transactions by round id, as the RoundExecuted event would show. */
  executedTxs = new Map<Hex, Hex>();

  constructor(
    public lim: VaultLimits,
    public vaultBalance: bigint,
  ) {}

  // ── reader ──
  async round(_v: Address, id: Hex) {
    const r = this.rounds.get(id);
    return { status: r?.status ?? ChainRoundStatus.None, total: r?.total ?? 0n };
  }
  async payee(_v: Address, id: Hex) {
    const p = this.payees.get(id);
    return { wallet: p?.wallet ?? null, payableAfter: p?.payableAfter ?? 0n };
  }
  async limits() {
    return this.lim;
  }
  async spentInWindow() {
    return 0n;
  }
  async paid(_v: Address, id: Hex) {
    return this.paidIds.has(id);
  }
  async chainTime() {
    return this.time;
  }
  /** Like the real reader: simulates token.transfer from the vault, so it also fails when the vault is short. */
  async canReceive(_v: Address, to: Address, amount: bigint) {
    return !this.blocked.has(to.toLowerCase()) && amount <= this.vaultBalance;
  }
  async vaultFunds() {
    return this.vaultBalance;
  }
  async executedTx(_v: Address, id: Hex) {
    return this.executedTxs.get(id) ?? null;
  }

  /** Owner action outside the agent: approveRound. */
  approve(roundId: Hex) {
    const r = this.rounds.get(roundId);
    if (!r || r.status !== ChainRoundStatus.Proposed) throw new Error("not proposed");
    r.status = ChainRoundStatus.Approved;
  }

  // ── executor ──
  async send({
    data,
    idempotencyKey,
    label,
  }: {
    to: Address;
    data: Hex;
    idempotencyKey: string;
    label: string;
  }) {
    if (this.failNext > 0) {
      this.failNext--;
      throw new ChainError(`${label}: transient`, true);
    }
    const prior = this.sentKeys.get(idempotencyKey);
    if (prior) return { txHash: prior }; // Circle-style dedupe
    const { functionName, args } = decodeFunctionData({ abi: misthosVaultAbi, data });
    this.calls.push(functionName);
    const revert = (why: string) => {
      throw new ChainError(`${label} failed on-chain: ${why}`, false);
    };
    if (functionName === "registerPayee") {
      const [id, wallet] = args as [Hex, Address];
      const cur = this.payees.get(id);
      if (cur?.wallet !== wallet)
        this.payees.set(id, { wallet, payableAfter: this.time + this.lim.payeeCooldown });
    } else if (functionName === "proposeRound") {
      const [roundId, payouts] = args as unknown as [
        Hex,
        { payoutId: Hex; contributorId: Hex; to: Address; amount: bigint }[],
        Hex,
      ];
      if (this.rounds.has(roundId)) revert("RoundExists");
      let total = 0n;
      for (const p of payouts) {
        if (p.amount > this.lim.maxPerPayout) revert("PayoutTooLarge");
        if (this.paidIds.has(p.payoutId)) revert("AlreadyPaid");
        const payee = this.payees.get(p.contributorId);
        if (!payee) revert("PayeeNotRegistered");
        if (payee!.wallet !== p.to) revert("PayeeMismatch");
        if (this.time < payee!.payableAfter) revert("PayeeInCooldown");
        total += p.amount;
      }
      if (total > this.lim.maxPerRound) revert("RoundTooLarge");
      this.rounds.set(roundId, { status: ChainRoundStatus.Proposed, total, payouts: [...payouts] });
    } else if (functionName === "executeRound") {
      const [roundId] = args as [Hex];
      const r = this.rounds.get(roundId);
      if (!r || (r.status !== ChainRoundStatus.Proposed && r.status !== ChainRoundStatus.Approved))
        revert("RoundNotExecutable");
      if (r!.status === ChainRoundStatus.Proposed && r!.total > this.lim.autoApproveThreshold)
        revert("ApprovalRequired");
      // Like MisthosVault: every payout is re-validated against the payees as they are now.
      for (const p of r!.payouts) {
        const payee = this.payees.get(p.contributorId);
        if (!payee || payee.wallet !== p.to) revert("PayeeMismatch");
        if (this.time < payee!.payableAfter) revert("PayeeInCooldown");
        if (this.paidIds.has(p.payoutId)) revert("AlreadyPaid");
        if (this.blocked.has(p.to.toLowerCase())) revert("Blocklisted");
      }
      if (r!.total > this.vaultBalance) revert("ERC20InsufficientBalance");
      for (const p of r!.payouts) {
        this.paidIds.add(p.payoutId);
        this.balances.set(
          p.to.toLowerCase(),
          (this.balances.get(p.to.toLowerCase()) ?? 0n) + p.amount,
        );
      }
      this.vaultBalance -= r!.total;
      r!.status = ChainRoundStatus.Executed;
      this.executedTxs.set(roundId, keccak256(toBytes(`tx:${idempotencyKey}`)));
    } else if (functionName === "cancelRound") {
      const [roundId] = args as [Hex];
      const r = this.rounds.get(roundId);
      if (!r || (r.status !== ChainRoundStatus.Proposed && r.status !== ChainRoundStatus.Approved))
        revert("RoundNotExecutable");
      r!.status = ChainRoundStatus.Cancelled;
    } else revert(`unexpected ${functionName}`);
    const txHash = keccak256(toBytes(`tx:${idempotencyKey}`));
    this.sentKeys.set(idempotencyKey, txHash);
    return { txHash };
  }
}
