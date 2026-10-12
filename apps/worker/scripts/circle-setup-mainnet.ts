/**
 * One-time Circle setup for the Arc Mainnet agent (blockchain "ARC"). Needs the owner's explicit go-ahead:
 *   1. a Circle production key (LIVE_API_KEY:…) in CIRCLE_LIVE_API_KEY, never the testnet key
 *   2. the entity secret: CIRCLE_MAINNET_ENTITY_SECRET, else CIRCLE_ENTITY_SECRET (it's scoped to the Circle account);
 *      `--new-entity-secret` generates and registers a separate one for production (recovery file outside the repo)
 *   3. a wallet set "misthos-agent-mainnet" with one SCA wallet on ARC (Gas Station sponsors its gas, billed to the
 *      card on the Circle account)
 *   4. CIRCLE_MAINNET_AGENT_WALLET_ID / CIRCLE_MAINNET_AGENT_WALLET_ADDRESS written to the root .env
 *   5. the SCA deployed with one harmless sponsored call (a view function on the mainnet vault template)
 * Idempotent: each step is skipped when its .env value already exists. Never prints secrets.
 *
 *   pnpm --filter @misthos/worker circle:setup:mainnet -- --confirm-mainnet
 */
import {
  initiateDeveloperControlledWalletsClient,
  registerEntitySecretCiphertext,
} from "@circle-fin/developer-controlled-wallets";
import { idempotencyUuid } from "@misthos/agent";
import { arcMainnet, getDeployment, misthosVaultAbi } from "@misthos/shared";
import { createPublicClient, encodeFunctionData, http, type Address } from "viem";
import { circleExecutor } from "../src/circle";
import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setEnvLine } from "./env-file";

const ENV_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.env");
const RECOVERY_DIR = path.join(homedir(), "misthos-circle-recovery-mainnet");
const args = process.argv.slice(2);

async function main() {
  if (!args.includes("--confirm-mainnet"))
    throw new Error(
      "This creates a real wallet on Arc Mainnet. Re-run with --confirm-mainnet once approved.",
    );
  const apiKey = process.env.CIRCLE_LIVE_API_KEY;
  if (!apiKey?.startsWith("LIVE_API_KEY:"))
    throw new Error("CIRCLE_LIVE_API_KEY must be a Circle production (LIVE_API_KEY:…) key.");
  const impl = getDeployment("arc-mainnet").vaultImplementation;
  if (!impl) throw new Error("No vault template on Arc Mainnet in deployments.json.");

  let entitySecret = process.env.CIRCLE_MAINNET_ENTITY_SECRET ?? process.env.CIRCLE_ENTITY_SECRET;
  if (args.includes("--new-entity-secret") && !process.env.CIRCLE_MAINNET_ENTITY_SECRET) {
    entitySecret = randomBytes(32).toString("hex");
    mkdirSync(RECOVERY_DIR, { recursive: true, mode: 0o700 });
    chmodSync(RECOVERY_DIR, 0o700);
    await registerEntitySecretCiphertext({
      apiKey,
      entitySecret,
      recoveryFileDownloadPath: RECOVERY_DIR,
    });
    console.log(
      `entity secret registered; .env: ${setEnvLine(ENV_PATH, "CIRCLE_MAINNET_ENTITY_SECRET", entitySecret)}`,
    );
    console.log(
      `recovery file saved in ${RECOVERY_DIR} (back it up; it's the only way to reset the secret)`,
    );
  }
  if (!entitySecret)
    throw new Error(
      "No entity secret: set CIRCLE_MAINNET_ENTITY_SECRET or pass --new-entity-secret.",
    );

  const client = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });
  let walletId = process.env.CIRCLE_MAINNET_AGENT_WALLET_ID;
  if (!walletId) {
    const set = await client.createWalletSet({ name: "misthos-agent-mainnet" });
    const walletSetId = set.data?.walletSet?.id;
    if (!walletSetId) throw new Error("Circle didn't return a wallet set id");
    const created = await client.createWallets({
      walletSetId,
      blockchains: ["ARC"],
      count: 1,
      accountType: "SCA",
    });
    const wallet = created.data?.wallets?.[0];
    if (!wallet?.id || !wallet.address) throw new Error("Circle didn't return a wallet");
    walletId = wallet.id;
    console.log(
      `.env CIRCLE_MAINNET_AGENT_WALLET_ID: ${setEnvLine(ENV_PATH, "CIRCLE_MAINNET_AGENT_WALLET_ID", wallet.id)}`,
    );
    setEnvLine(
      ENV_PATH,
      "CIRCLE_MAINNET_AGENT_WALLET_ADDRESS",
      wallet.address,
      "Agent SCA address on Arc Mainnet (public; vault agent role)",
    );
  }
  const w = (await client.getWallet({ id: walletId })).data?.wallet;
  if (w?.blockchain !== "ARC") throw new Error(`Expected an ARC wallet, got ${w?.blockchain}`);
  console.log(`agent wallet: ${w.address} · ${w.blockchain} · ${w.accountType} · state ${w.state}`);

  const pub = createPublicClient({ chain: arcMainnet, transport: http() });
  const address = w.address as Address;
  if (!(await pub.getCode({ address }))) {
    const { txHash } = await circleExecutor(client, walletId, address).send({
      to: impl,
      data: encodeFunctionData({ abi: misthosVaultAbi, functionName: "token" }),
      idempotencyKey: idempotencyUuid(`deploy-sca-mainnet:${address}`),
      label: "deploy mainnet agent SCA",
    });
    console.log(`agent SCA deployed: https://explorer.arc.io/tx/${txHash}`);
  } else {
    console.log("agent SCA already deployed");
  }
}

main().catch((e) => {
  const err = e as {
    message?: string;
    response?: { status?: number; data?: { message?: string; code?: number } };
  };
  console.error(
    "circle mainnet setup failed:",
    err.response?.status ?? "",
    err.response?.data?.message ?? err.message,
  );
  process.exit(1);
});
