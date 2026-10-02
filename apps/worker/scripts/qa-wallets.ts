/**
 * QA: create (once) five testnet-only wallets and fund them. Keys go to <repo>/.qa-wallets.json (gitignored) and are
 * never printed. Funding tries Circle's testnet faucet with our API key first, then falls back to a small transfer
 * from the deployer.
 *
 *   pnpm --filter @misthos/worker exec tsx --env-file=../../.env scripts/qa-wallets.ts [--fund]
 */
import { circleClient } from "../src/circle";
import { arcTestnet } from "@misthos/shared";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createPublicClient, createWalletClient, erc20Abi, formatUnits, http, parseUnits, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const FILE = path.resolve(import.meta.dirname, "../../../.qa-wallets.json");
const ROLES = ["owner", "owner2", "alice", "bob", "carol"] as const;
const USDC = "0x3600000000000000000000000000000000000000" as const;
/** Target balances (USDC): the owner funds vaults and pays gas; owner-2 pays gas for authz tests; contributors only sign. */
const TARGET: Record<(typeof ROLES)[number], string> = { owner: "4", owner2: "0.2", alice: "0", bob: "0", carol: "0" };

type Wallets = Record<(typeof ROLES)[number], { address: string; key: Hex }>;

function load(): Wallets {
  if (existsSync(FILE)) return JSON.parse(readFileSync(FILE, "utf8")) as Wallets;
  const w = Object.fromEntries(
    ROLES.map((r) => {
      const key = generatePrivateKey();
      return [r, { address: privateKeyToAccount(key).address, key }];
    }),
  ) as Wallets;
  writeFileSync(FILE, JSON.stringify(w, null, 2), { mode: 0o600 });
  console.log("created", path.relative(process.cwd(), FILE));
  return w;
}

const pub = createPublicClient({ chain: arcTestnet, transport: http() });
const balance = (a: string) =>
  pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [a as Hex] });

async function main() {
  const w = load();
  for (const r of ROLES) console.log(r.padEnd(7), w[r].address, formatUnits(await balance(w[r].address), 6), "USDC");
  if (!process.argv.includes("--fund")) return;

  const circle = circleClient(process.env.CIRCLE_API_KEY!, process.env.CIRCLE_ENTITY_SECRET!);
  const deployer = createWalletClient({
    account: privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY as Hex),
    chain: arcTestnet,
    transport: http(),
  });
  let fromDeployer = 0n;
  for (const r of ROLES) {
    const want = parseUnits(TARGET[r], 6);
    const have = await balance(w[r].address);
    if (have >= want) continue;
    let viaFaucet = false;
    try {
      const res = await circle.requestTestnetTokens({
        address: w[r].address,
        blockchain: "ARC-TESTNET" as never,
        usdc: true,
      });
      viaFaucet = res.status >= 200 && res.status < 300;
      console.log(r, "faucet:", res.status);
    } catch (e) {
      const err = e as { response?: { status?: number; data?: { message?: string } }; message?: string };
      console.log(r, "faucet unavailable:", err.response?.status ?? "", err.response?.data?.message ?? err.message);
    }
    if (viaFaucet) {
      for (let i = 0; i < 20 && (await balance(w[r].address)) < want; i++) await new Promise((x) => setTimeout(x, 3000));
      if ((await balance(w[r].address)) >= want) continue;
    }
    const need = want - (await balance(w[r].address));
    if (need <= 0n) continue;
    const hash = await deployer.writeContract({ address: USDC, abi: erc20Abi, functionName: "transfer", args: [w[r].address as Hex, need] });
    await pub.waitForTransactionReceipt({ hash });
    fromDeployer += need;
    console.log(r, "funded from deployer:", formatUnits(need, 6), "USDC", hash);
  }
  console.log("from deployer total:", formatUnits(fromDeployer, 6), "USDC");
  for (const r of ROLES) console.log(r.padEnd(7), formatUnits(await balance(w[r].address), 6), "USDC");
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
