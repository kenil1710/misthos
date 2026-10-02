/**
 * Live probe of the Circle agent wallet on Arc testnet:
 *  1. EIP-191 signature from the SCA verifies (ERC-6492 before deployment, ERC-1271 after)
 *  2. the SCA executes a vault call with Gas Station-sponsored gas (registerPayee on the smoke vault, after the
 *     deployer (owner) points the smoke vault's agent at the SCA)
 *   pnpm --filter @misthos/worker circle:probe
 */
import { idempotencyUuid } from "@misthos/agent";
import { arcTestnet, getDeployment, misthosVaultAbi, verifyWalletSignature } from "@misthos/shared";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  keccak256,
  toBytes,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { circleClient, circleExecutor, circleSigner } from "../src/circle";

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is not set`);
  return v;
};
const explorer = (h: string) => `https://explorer.testnet.arc.io/tx/${h}`;

async function main() {
  const pub = createPublicClient({ chain: arcTestnet, transport: http() });
  const client = circleClient(env("CIRCLE_API_KEY"), env("CIRCLE_ENTITY_SECRET"));
  const sca = env("CIRCLE_AGENT_WALLET_ADDRESS") as Address;
  const walletId = env("CIRCLE_AGENT_WALLET_ID");
  const signer = circleSigner(client, walletId, sca);
  const executor = circleExecutor(client, walletId, sca);
  const vault = getDeployment("arc-testnet").smokeVault!;

  const verify = async (label: string) => {
    const hash = keccak256(toBytes(`misthos circle probe ${label} ${Date.now()}`));
    const signature = await signer.signHash(hash);
    const ok = await verifyWalletSignature(pub, {
      address: sca,
      message: { raw: hash },
      signature,
    });
    console.log(`signature (${label}): ${signature.length / 2 - 1} bytes, verifies on Arc: ${ok}`);
    return ok;
  };

  console.log(
    `SCA ${sca} code deployed: ${(await pub.getCode({ address: sca }))?.length ? "yes" : "no"}`,
  );
  try {
    await verify("before first tx");
  } catch (e) {
    console.log(
      `signing before deployment refused by Circle (expected): ${(e as Error).message.split(".")[0]}`,
    );
  }

  // Owner (deployer) points the smoke vault's agent at the SCA, once.
  const currentAgent = await pub.readContract({
    address: vault,
    abi: misthosVaultAbi,
    functionName: "agent",
  });
  if (currentAgent.toLowerCase() !== sca.toLowerCase()) {
    const owner = createWalletClient({
      chain: arcTestnet,
      transport: http(),
      account: privateKeyToAccount(env("DEPLOYER_PRIVATE_KEY") as Hex),
    });
    const hash = await owner.writeContract({
      address: vault,
      abi: misthosVaultAbi,
      functionName: "setAgent",
      args: [sca],
    });
    await pub.waitForTransactionReceipt({ hash });
    console.log(`setAgent → SCA: ${explorer(hash)}`);
  }

  const contributorId = keccak256(toBytes("circle-probe-contributor"));
  const payee = privateKeyToAccount(env("DEPLOYER_PRIVATE_KEY") as Hex).address;
  const before = await pub.getBalance({ address: sca });
  const started = Date.now();
  const { txHash } = await executor.send({
    to: vault,
    data: encodeFunctionData({
      abi: misthosVaultAbi,
      functionName: "registerPayee",
      args: [contributorId, payee],
    }),
    idempotencyKey: idempotencyUuid(`probe:registerPayee:${vault}:${contributorId}`),
    label: "probe registerPayee",
  });
  const receipt = await pub.getTransactionReceipt({ hash: txHash });
  console.log(
    `registerPayee via Circle SCA: ${explorer(txHash)} · status ${receipt.status} · ${Date.now() - started} ms`,
  );
  console.log(
    `SCA native balance before/after: ${before} / ${await pub.getBalance({ address: sca })} (unchanged = gas sponsored)`,
  );
  const p = await pub.readContract({
    address: vault,
    abi: misthosVaultAbi,
    functionName: "payeeOf",
    args: [contributorId],
  });
  console.log(`payeeOf: ${p.wallet} payableAfter ${p.payableAfter}`);

  // Same idempotency key again must return the same transaction, not a second one.
  const again = await executor.send({
    to: vault,
    data: encodeFunctionData({
      abi: misthosVaultAbi,
      functionName: "registerPayee",
      args: [contributorId, payee],
    }),
    idempotencyKey: idempotencyUuid(`probe:registerPayee:${vault}:${contributorId}`),
    label: "probe registerPayee (retry)",
  });
  console.log(`retry with same key returns same tx: ${again.txHash === txHash}`);

  console.log(`SCA code deployed: ${(await pub.getCode({ address: sca }))?.length ? "yes" : "no"}`);
  await verify("after deployment");
}

main().catch((e) => {
  console.error("probe failed:", (e as Error).message);
  process.exit(1);
});
