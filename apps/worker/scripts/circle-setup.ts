/**
 * One-time Circle setup for the agent (ARC-TESTNET):
 *   1. generate + register an entity secret (recovery file saved OUTSIDE the repo)
 *   2. create a wallet set and one SCA wallet (Gas Station sponsors SCA gas on testnet by default)
 *   3. write CIRCLE_ENTITY_SECRET / CIRCLE_AGENT_WALLET_ID / CIRCLE_AGENT_WALLET_ADDRESS into the root .env
 * Idempotent: each step is skipped when its .env value already exists. Never prints secrets.
 *
 *   pnpm --filter @misthos/worker circle:setup
 */
import {
  initiateDeveloperControlledWalletsClient,
  registerEntitySecretCiphertext,
} from "@circle-fin/developer-controlled-wallets";
import { idempotencyUuid } from "@misthos/agent";
import { arcTestnet, getDeployment, misthosVaultAbi } from "@misthos/shared";
import { createPublicClient, encodeFunctionData, http, type Address } from "viem";
import { circleExecutor } from "../src/circle";
import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setEnvLine } from "./env-file";

const ENV_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.env");
const RECOVERY_DIR = path.join(homedir(), "misthos-circle-recovery");

async function main() {
  const apiKey = process.env.CIRCLE_API_KEY;
  if (!apiKey?.startsWith("TEST_API_KEY:"))
    throw new Error("CIRCLE_API_KEY must be a testnet (TEST_API_KEY:…) key.");

  let entitySecret = process.env.CIRCLE_ENTITY_SECRET;
  if (!entitySecret) {
    entitySecret = randomBytes(32).toString("hex");
    mkdirSync(RECOVERY_DIR, { recursive: true, mode: 0o700 });
    chmodSync(RECOVERY_DIR, 0o700);
    await registerEntitySecretCiphertext({
      apiKey,
      entitySecret,
      recoveryFileDownloadPath: RECOVERY_DIR,
    });
    console.log(
      `entity secret registered; .env: ${setEnvLine(ENV_PATH, "CIRCLE_ENTITY_SECRET", entitySecret)}`,
    );
    console.log(
      `recovery file saved in ${RECOVERY_DIR} (back it up somewhere safe; it is the only way to reset the secret)`,
    );
  } else {
    console.log("entity secret already configured; skipping registration");
  }

  const client = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });
  let walletId = process.env.CIRCLE_AGENT_WALLET_ID;
  if (!walletId) {
    const set = await client.createWalletSet({ name: "misthos-agent" });
    const walletSetId = set.data?.walletSet?.id;
    if (!walletSetId) throw new Error("Circle didn't return a wallet set id");
    const created = await client.createWallets({
      walletSetId,
      blockchains: ["ARC-TESTNET"],
      count: 1,
      accountType: "SCA",
    });
    const wallet = created.data?.wallets?.[0];
    if (!wallet?.id || !wallet.address) throw new Error("Circle didn't return a wallet");
    walletId = wallet.id;
    console.log(
      `.env CIRCLE_AGENT_WALLET_ID: ${setEnvLine(ENV_PATH, "CIRCLE_AGENT_WALLET_ID", wallet.id)}`,
    );
    setEnvLine(
      ENV_PATH,
      "CIRCLE_AGENT_WALLET_ADDRESS",
      wallet.address,
      "Agent SCA address on ARC-TESTNET (public; vault agent role)",
    );
  }
  const w = (await client.getWallet({ id: walletId })).data?.wallet;
  console.log(
    `agent wallet: ${w?.address} · ${w?.blockchain} · ${w?.accountType} · state ${w?.state}`,
  );

  // Circle signs only from deployed SCAs, and an SCA deploys on its first transaction. Send a harmless sponsored
  // call (a view function on our vault implementation) once.
  const pub = createPublicClient({ chain: arcTestnet, transport: http() });
  const address = w!.address as Address;
  if (!(await pub.getCode({ address }))) {
    const impl = getDeployment("arc-testnet").vaultImplementation!;
    const { txHash } = await circleExecutor(client, walletId, address).send({
      to: impl,
      data: encodeFunctionData({ abi: misthosVaultAbi, functionName: "token" }),
      idempotencyKey: idempotencyUuid(`deploy-sca:${address}`),
      label: "deploy agent SCA",
    });
    console.log(`agent SCA deployed: https://explorer.testnet.arc.io/tx/${txHash}`);
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
    "circle setup failed:",
    err.response?.status ?? "",
    err.response?.data?.message ?? err.message,
  );
  process.exit(1);
});
