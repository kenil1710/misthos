/** Return USDC left in earlier QA vaults to the QA owner (owner-signed withdraw). Testnet only. */
import nextEnv from "@next/env";
import { arcTestnet, misthosVaultAbi } from "@misthos/shared";
import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { createPublicClient, createWalletClient, formatUnits, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const ROOT = path.resolve(import.meta.dirname, "../../../..");
nextEnv.loadEnvConfig(ROOT);
const W = JSON.parse(readFileSync(path.join(ROOT, ".qa-wallets.json"), "utf8")) as Record<
  string,
  { key: Hex; address: Hex }
>;
const account = privateKeyToAccount(W.owner!.key);
const pub = createPublicClient({ chain: arcTestnet, transport: http() });
const wallet = createWalletClient({ account, chain: arcTestnet, transport: http() });
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const { rows } = await db.query<{ v: string }>(
  `select p.vault_address as v from programs p join users u on u.id = p.owner_user_id
   where p.is_demo and p.vault_address is not null and u.wallet_address = $1`,
  [account.address.toLowerCase()],
);
await db.end();
for (const { v } of rows) {
  const vault = v as Hex;
  const bal = await pub.readContract({
    address: vault,
    abi: misthosVaultAbi,
    functionName: "balance",
  });
  if (bal === 0n) continue;
  const hash = await wallet.writeContract({
    address: vault,
    abi: misthosVaultAbi,
    functionName: "withdraw",
    args: [account.address, bal],
  });
  await pub.waitForTransactionReceipt({ hash });
  console.log(`withdrew ${formatUnits(bal, 6)} USDC from ${vault}: ${hash}`);
}
