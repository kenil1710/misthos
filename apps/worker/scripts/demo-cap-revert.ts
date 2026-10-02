/**
 * Demo: the agent tries to pay more than the vault's maxPerPayout and the contract refuses.
 *
 *   pnpm --filter @misthos/worker demo:cap-revert [vaultAddress] [--broadcast]
 *
 * Simulates proposeRound as the agent wallet (eth_call from the agent SCA) twice: at exactly maxPerPayout (accepted)
 * and 1 USDC above it (reverts with PayoutTooLarge). With --broadcast it also sends the over-cap call through
 * Circle, so the refusal is visible as a failed attempt. Defaults to the latest live-round vault, else the smoke vault.
 */
import { idempotencyUuid, roundIdBytes32 } from "@misthos/agent";
import { arcTestnet, formatUsdc, getDeployment, misthosVaultAbi } from "@misthos/shared";
import { existsSync, readFileSync } from "node:fs";
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  encodeFunctionData,
  http,
  keccak256,
  toBytes,
  type Address,
  type Hex,
} from "viem";
import { circleClient, circleExecutor } from "../src/circle";

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is not set`);
  return v;
};
const LIVE = new URL("./.live-round.json", import.meta.url);

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const broadcast = args.includes("--broadcast");
  const vault = (args.find((a) => a.startsWith("0x")) ??
    (existsSync(LIVE)
      ? JSON.parse(readFileSync(LIVE, "utf8")).vault
      : getDeployment("arc-testnet").smokeVault)) as Address;
  const agent = env("CIRCLE_AGENT_WALLET_ADDRESS") as Address;
  const pub = createPublicClient({ chain: arcTestnet, transport: http() });

  const limits = await pub.readContract({
    address: vault,
    abi: misthosVaultAbi,
    functionName: "limits",
  });
  const onChainAgent = await pub.readContract({
    address: vault,
    abi: misthosVaultAbi,
    functionName: "agent",
  });
  console.log(`vault ${vault}`);
  console.log(
    `agent ${onChainAgent}${onChainAgent.toLowerCase() === agent.toLowerCase() ? " (Misthos agent SCA)" : " (NOT the configured agent)"}`,
  );
  console.log(
    `maxPerPayout ${formatUsdc(limits.maxPerPayout)} · maxPerRound ${formatUsdc(limits.maxPerRound)}\n`,
  );

  // A registered payee is required for a proposal to reach the amount check; use the probe/live contributor if present.
  const live = existsSync(LIVE) ? JSON.parse(readFileSync(LIVE, "utf8")) : null;
  const contributorId = (live?.demoContributorBytes32 ??
    keccak256(toBytes("circle-probe-contributor"))) as Hex;
  const payee = await pub.readContract({
    address: vault,
    abi: misthosVaultAbi,
    functionName: "payeeOf",
    args: [contributorId],
  });
  const roundId = roundIdBytes32(`demo-${Date.now()}`);
  const payout = (amount: bigint) => ({
    payoutId: keccak256(toBytes(`demo-payout-${roundId}-${amount}`)),
    contributorId,
    to: payee.wallet,
    amount,
    decisionHash: keccak256(toBytes("demo-decision")),
  });

  for (const [label, amount] of [
    ["at the cap", limits.maxPerPayout],
    ["1 USDC over the cap", limits.maxPerPayout + 1_000_000n],
  ] as const) {
    try {
      await pub.simulateContract({
        account: agent,
        address: vault,
        abi: misthosVaultAbi,
        functionName: "proposeRound",
        args: [roundId, [payout(amount)], keccak256("0x")],
      });
      console.log(`✓ ${formatUsdc(amount)} (${label}): the vault would accept this proposal`);
    } catch (e) {
      const revert =
        e instanceof BaseError ? e.walk((x) => x instanceof ContractFunctionRevertedError) : null;
      if (revert instanceof ContractFunctionRevertedError) {
        const a = revert.data?.args ?? [];
        console.log(
          `✗ ${formatUsdc(amount)} (${label}): REVERTED with ${revert.data?.errorName}(payoutId, amount ${formatUsdc(a[1] as bigint)}, max ${formatUsdc(a[2] as bigint)})`,
        );
      } else {
        console.log(`✗ ${formatUsdc(amount)} (${label}): ${(e as Error).message.split("\n")[0]}`);
      }
    }
  }

  if (broadcast) {
    console.log("\nSending the over-cap proposal for real through the agent's Circle wallet…");
    const circle = circleClient(env("CIRCLE_API_KEY"), env("CIRCLE_ENTITY_SECRET"));
    try {
      const { txHash } = await circleExecutor(circle, env("CIRCLE_AGENT_WALLET_ID"), agent).send({
        to: vault,
        data: encodeFunctionData({
          abi: misthosVaultAbi,
          functionName: "proposeRound",
          args: [roundId, [payout(limits.maxPerPayout + 1_000_000n)], keccak256("0x")],
        }),
        idempotencyKey: idempotencyUuid(`demo-over-cap:${roundId}`),
        label: "over-cap proposeRound",
      });
      console.log(`unexpected: transaction landed ${txHash}`);
    } catch (e) {
      console.log(`refused: ${(e as Error).message}`);
    }
  }
}

main().catch((e) => {
  console.error("demo failed:", (e as Error).message);
  process.exit(1);
});
