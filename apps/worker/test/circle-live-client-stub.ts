import {
  createWalletClient,
  http,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { CircleClient } from "../src/circle";

/**
 * TEST ONLY. Stands in for Circle's production (LIVE) Developer-Controlled Wallets client on a local Anvil fork of Arc
 * Mainnet: the three calls the worker makes (contract execution, transaction status, message signing) are served by a
 * local test key, so the worker's real `circleExecutor` / `circleSigner` code runs end to end without Circle, without
 * a real wallet and without real funds. Like Circle, a repeated idempotency key returns the original transaction.
 * Never imported by `src/`; it logs once when created so a run always says it used the stub.
 */
export class CircleLiveClientStub {
  readonly address: Address;
  private readonly wallet: WalletClient;
  private readonly txs = new Map<string, { hash: Hex; state: "COMPLETE" | "FAILED" }>();
  private readonly byKey = new Map<string, string>();
  readonly calls: { method: string; walletId: string; label?: string }[] = [];

  constructor(
    private readonly o: {
      privateKey: Hex;
      walletId: string;
      rpcUrl: string;
      client: PublicClient;
      log?: (msg: string) => void;
    },
  ) {
    const account = privateKeyToAccount(o.privateKey);
    this.address = account.address;
    this.wallet = createWalletClient({ account, chain: o.client.chain, transport: http(o.rpcUrl) });
    (o.log ?? console.info)(
      `[CircleLiveClientStub] TEST ONLY: Circle LIVE client replaced by a local key ${account.address} on ${o.rpcUrl}`,
    );
  }

  private wallet_(walletId: string) {
    if (walletId !== this.o.walletId)
      throw new Error(`CircleLiveClientStub: unknown wallet ${walletId}`);
  }

  async createContractExecutionTransaction(p: {
    walletId: string;
    contractAddress: string;
    callData: string;
    idempotencyKey?: string;
    refId?: string;
  }) {
    this.wallet_(p.walletId);
    this.calls.push({
      method: "createContractExecutionTransaction",
      walletId: p.walletId,
      label: p.refId,
    });
    const known = p.idempotencyKey ? this.byKey.get(p.idempotencyKey) : undefined;
    if (known) return { data: { id: known, state: "INITIATED" } };
    // Like Circle, a call that would revert is refused at estimation and never lands.
    await this.o.client.call({
      account: this.address,
      to: p.contractAddress as Address,
      data: p.callData as Hex,
    });
    const hash = await this.wallet.sendTransaction({
      account: this.wallet.account!,
      chain: this.wallet.chain,
      to: p.contractAddress as Address,
      data: p.callData as Hex,
    });
    const receipt = await this.o.client.waitForTransactionReceipt({ hash });
    const id = `stub-${this.txs.size + 1}`;
    this.txs.set(id, { hash, state: receipt.status === "success" ? "COMPLETE" : "FAILED" });
    if (p.idempotencyKey) this.byKey.set(p.idempotencyKey, id);
    return { data: { id, state: "INITIATED" } };
  }

  async getTransaction(p: { id: string }) {
    const t = this.txs.get(p.id);
    return { data: { transaction: t ? { id: p.id, state: t.state, txHash: t.hash } : undefined } };
  }

  async signMessage(p: { walletId: string; message: string; encodedByHex?: boolean }) {
    this.wallet_(p.walletId);
    this.calls.push({ method: "signMessage", walletId: p.walletId });
    const signature = await this.wallet.signMessage({
      account: this.wallet.account!,
      message: p.encodedByHex ? { raw: p.message as Hex } : p.message,
    });
    return { data: { signature } };
  }

  /** As the worker's CircleClient type (only the three methods above are ever called). */
  asCircleClient(): CircleClient {
    return this as unknown as CircleClient;
  }
}
