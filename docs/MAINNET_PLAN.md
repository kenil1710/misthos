# Arc Mainnet support — plan and log

Branch: `mainnet` (never merged into `main` by an agent). Production (https://misthos.world, `main`) stays on Arc
Testnet and is unchanged. Deadline: Oct 17, 2026 11:59 PM ET.

> Morning report: see the top section once the overnight run finishes.

## Hard rules (from the owner)

1. Only the `mainnet` branch; never commit/merge/push to `main`; never deploy production Vercel/Railway or change their env.
2. Only approved mainnet transaction: the vault template + factory deploy (already done on 2026-10-10, see below).
   No agent wallet, no vaults, no deposits, no transfers on mainnet.
3. No secrets printed, logged or committed.
4. Testnet programs/vaults/submissions/data untouched; tests use throwaway databases (PGlite), never Neon.
5. Testnet behavior unchanged; anything that could change it gets a test.

## Mainnet contracts (Arc Mainnet, chain 5042) — deployed 2026-10-10, not redeployed

| Contract                | Address                                      | Tx                                                                   |
| ----------------------- | -------------------------------------------- | -------------------------------------------------------------------- |
| MisthosVault (template) | `0x36E677De57Ce0f59eFed05a748B07c7Bb07d5dBb` | `0x336c7fc4d57cc56c1923ac1842a4c16e964284926fec535092372d2f34836476` |
| MisthosVaultFactory     | `0x9075CbB50639216C2e4E32013514baa01f2b0C1b` | `0x430aedcedc4ce351843ed14cbf74565b93d66cb625f6c580fd78fb61a80f05a0` |

Checked on-chain 2026-10-12: both have code; `factory.implementation()` = the template. Deployer
`0x6B4824a6399D778D1bBfE982551082673c62fdff` holds 0.453901 USDC (0.50 − 0.046 gas).

## Status

### Done

- Shared: `circleBlockchain: "ARC"` for Arc Mainnet; `CHAIN_KEYS`, `isChainKey`, `chainConfigById`; mainnet addresses
  in `deployments.json`.
- Web server: every on-chain read/check takes the program's chain (`chainConfig(key)`, `publicClient(key)`,
  `factoryAddress(chain)`, `agentAddress(chain)`, `readVault(v, chain)`, `findVaultEvent(..., chain)`,
  `findVaultCreated(tx, chain)`); routes deploy/deposit/limits/vault-control/round-approved pass `program.chain`.
  Mainnet agent address comes only from `CIRCLE_MAINNET_AGENT_WALLET_ADDRESS` (never the testnet one).
- SIWE: owners sign in from either Arc chain id; the signature is checked on the chain it names.
- Contributor wallet link: the signed message carries the program's chain id; signature checked on that chain.
- Wallet UI: wagmi config has both Arc chains; every owner tx passes `chainId` of the program (`useTargetNetwork`
  inside `ProgramNetwork`), so wagmi asks the wallet to switch/add the right network.
- Wizard: network picker (Testnet default; Mainnet needs the "real USDC" checkbox; disabled when not configured);
  `createProgramAction` refuses networks the server can't serve (`availableChains()`).
- Worker: `CIRCLE_LIVE_API_KEY` + `CIRCLE_MAINNET_AGENT_WALLET_ID/_ADDRESS` (+ optional `CIRCLE_MAINNET_ENTITY_SECRET`,
  `ARC_MAINNET_RPC_URL`). Per-job `depsFor` by the program's chain. Missing/partial/invalid mainnet config → mainnet
  off with one warning at start, mainnet jobs skipped with a log line (rows unchanged), housekeeping (due rounds,
  recovery, sweep) only for served networks. Worker refuses `NEXT_PUBLIC_CHAIN=arc-mainnet` (the testnet key/EOA
  can never serve mainnet).
- Agent: `onProgramNetwork(chainId, program.chain)` guard in processSubmission / processOverride / syncPayee /
  runRound — wrong-network deps change nothing (tested).
- `circle:setup:mainnet` script (needs `--confirm-mainnet` and a LIVE key; not run).

### Left (in order)

1. Shared `networkConfig(chain)` helper (chain id, RPC, explorer, USDC, factory, Circle blockchain, agent wallet).
2. Network switch in the header (cookie, default Testnet) + badge on every page; filters owner lists, `/c`,
   landing "See it live"/metrics strip, public pages, admin metrics.
3. Wizard: "Coming soon" wording, safe mainnet limits, owner approval for every mainnet round.
4. Join / contributor pages: badge; wallet link message names the network.
5. Verify: record chain must match the program's chain; explorer links per record.
6. Metrics split testnet/mainnet everywhere incl. "Copy for submission form".
7. Copy: real vs test USDC, faucet only on testnet.
8. `.env.example`, `docs/MAINNET.md`, update Oct 10 → Oct 17 deadline in docs.
9. Anvil fork of Arc Mainnet: full loop with a Circle LIVE client stub.
10. e2e both networks, axe both themes, Lighthouse.
11. Independent security review; fix Critical/High.
12. Preview deployment (see Blocked).

### Blocked / needs the owner

- Mainnet agent wallet (needs the Circle LIVE key) — hard stop.
- Vercel preview: every env var on the Vercel project is scoped to Production only, so preview builds of this branch
  have no database or session secret. A working preview needs Preview-scoped variables (a throwaway database, a
  session secret, X client, testnet chain) — a settings change the owner must make.

## Decisions

- D1 (2026-10-12) Mainnet Circle key variable is `CIRCLE_LIVE_API_KEY` (owner's name), renamed from the earlier
  `CIRCLE_MAINNET_API_KEY` draft. It must start with `LIVE_API_KEY:`.
- D2 Mainnet entity secret: `CIRCLE_MAINNET_ENTITY_SECRET`, falling back to `CIRCLE_ENTITY_SECRET` (an entity secret
  belongs to the Circle account). `circle:setup:mainnet --new-entity-secret` registers a separate one if Circle asks.
- D3 Mainnet misconfiguration never stops the worker: it turns mainnet off (one warning with the reason, variable
  names only). Jobs of mainnet programs complete as "skipped" without touching rows; the sweeper/recovery pick them up
  once mainnet is configured.
- D4 Worker primary network is always Arc Testnet; Arc Mainnet only through its own LIVE agent. Also refused: a
  mainnet agent wallet id/address equal to the testnet one.
- D5 Agent-level guard as defense in depth: each entry point compares `deps.chainId` with the program's chain before
  claiming, locking, signing or sending.
- D6 The mainnet factory/template are not redeployed (already on-chain, verified).
- D7 Unit tests run with `--concurrency=1` across packages: in parallel, PGlite-heavy suites time out on this machine
  (not failures in the code; each package passes alone).
