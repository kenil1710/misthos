// Writes typed ABI modules for viem/wagmi from Foundry output. Run after changing contracts: pnpm --filter @misthos/contracts abi
import { readFileSync, writeFileSync } from "node:fs";
const targets = [
  ["MisthosVault", "misthosVaultAbi", "vault"],
  ["MisthosVaultFactory", "misthosVaultFactoryAbi", "factory"],
];
for (const [contract, name, file] of targets) {
  const { abi } = JSON.parse(readFileSync(`out/${contract}.sol/${contract}.json`, "utf8"));
  writeFileSync(
    `../shared/src/abi/${file}.ts`,
    `// Generated from packages/contracts/out/${contract}.sol by export-abi.mjs. Do not edit.\nexport const ${name} = ${JSON.stringify(abi, null, 2)} as const;\n`,
  );
  console.log(`wrote ${file}.ts (${abi.length} entries)`);
}
