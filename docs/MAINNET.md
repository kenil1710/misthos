# Misthos on Arc Mainnet

Misthos runs campaigns on two networks side by side: **Arc Testnet** (test USDC, free to try, the default) and **Arc
Mainnet** (real USDC). Each campaign lives on exactly one network, chosen when it's created; it never moves. This page
covers how network selection works, the deployed mainnet contracts, how to turn mainnet on, safe starting limits and
the security model.

## Networks at a glance

|                      | Arc Testnet                                  | Arc Mainnet                                        |
| -------------------- | -------------------------------------------- | -------------------------------------------------- |
| Chain id             | 5042002                                      | 5042                                               |
| RPC                  | https://rpc.testnet.arc.io (`ARC_RPC_URL`)   | https://rpc.mainnet.arc.io (`ARC_MAINNET_RPC_URL`) |
| Explorer             | https://explorer.testnet.arc.io              | https://explorer.arc.io                            |
| USDC (ERC-20, 6 dec) | `0x3600000000000000000000000000000000000000` | `0x3600000000000000000000000000000000000000`       |
| Vault factory        | `0x19afd6fCeb49A333B3b3b455A26e6ee43db8849b` | `0x9075CbB50639216C2e4E32013514baa01f2b0C1b`       |
| Vault template       | `0xbB016FeB193c9F1151e77444a2145c5dfAA965D7` | `0x36E677De57Ce0f59eFed05a748B07c7Bb07d5dBb`       |
| Circle blockchain    | `ARC-TESTNET`                                | `ARC`                                              |
| Agent wallet         | `CIRCLE_AGENT_WALLET_ADDRESS`                | `CIRCLE_MAINNET_AGENT_WALLET_ADDRESS`              |
| Circle key           | `CIRCLE_API_KEY` (TEST)                      | `CIRCLE_LIVE_API_KEY` (LIVE)                       |
| Faucet               | https://faucet.circle.com                    | none: real USDC                                    |

In code, `networkConfig(chain)` (`packages/shared/src/network.ts`) returns all of this for a program's `chain`; an
unknown network throws instead of falling back to another one.

## Deployed mainnet contracts

Deployed 2026-10-10 from a single-purpose deployer `0x6B4824a6399D778D1bBfE982551082673c62fdff` (not the testnet key),
both exact matches on Sourcify. The factory has no owner; each vault belongs to its campaign's owner.

| Contract            | Address                                      | Transaction                                                          | Block    |
| ------------------- | -------------------------------------------- | -------------------------------------------------------------------- | -------- |
| MisthosVault        | `0x36E677De57Ce0f59eFed05a748B07c7Bb07d5dBb` | `0x336c7fc4d57cc56c1923ac1842a4c16e964284926fec535092372d2f34836476` | 25234909 |
| MisthosVaultFactory | `0x9075CbB50639216C2e4E32013514baa01f2b0C1b` | `0x430aedcedc4ce351843ed14cbf74565b93d66cb625f6c580fd78fb61a80f05a0` | 25234911 |

Addresses are in `packages/shared/src/deployments.json` (`arc-mainnet`); the broadcast logs are in
`packages/contracts/broadcast/Deploy.s.sol/5042/`.

## How network selection works

- **Header switch.** Every page shows a network badge in the header: **Testnet** (amber dot) or **Mainnet** (green
  dot). Off a campaign's pages it's a switch: the visitor's choice is remembered in the `misthos_network` cookie (and
  `localStorage` as a fallback), default Testnet. A small script puts it on `<html data-network>` before the first
  paint, so cached pages (the landing page) never flash the other network.
- **What follows the switch.** The owner's campaign list, program switcher and "Needs you"; "Programs you joined"
  (`/c`) and its totals; the landing page's "See it live" and live numbers; the metrics page order. Testnet and mainnet
  USDC are never added together anywhere.
- **Campaign pages** (overview, settings, treasury, rounds, join, contributor, public audit, receipts) always use the
  campaign's own network: the header shows its badge instead of the switch, explorer links go to its explorer, every
  vault read and check uses its RPC and factory, and every owner transaction is pinned to its chain id, so the wallet
  is asked to switch to (or add) that Arc network before signing.
- **Wizard.** A network picker with Arc Testnet selected. Arc Mainnet needs the "real USDC" confirmation and suggests
  safe limits (below). It's only offered when this deployment has both the mainnet factory and the mainnet agent
  wallet; otherwise it shows **Coming soon** (disabled). The server refuses a network it can't serve.
- **Sign-in.** Owners sign in from either Arc chain id; a smart-wallet signature is checked on the chain it names.
- **Contributors.** A payout wallet address is the same on both networks. On a mainnet campaign the wallet switches to
  Arc Mainnet before signing the link message, and the message says "Network: Arc Mainnet (real USDC)". Testnet
  campaigns behave exactly as before.
- **Verify and receipts.** Verify reads the chain id inside the signed record, requires it to be the campaign's network
  (before reading anything on-chain), then checks the signature, the factory and the agent at the payout's block on
  that network. Receipts, audit pages and explorer links use each record's network.
- **Metrics.** Both networks side by side; "Copy for submission form" reports Arc Mainnet and Arc Testnet separately.

## Turning mainnet on (owner checklist)

Nothing reaches Arc Mainnet until all of this is done. Until then the wizard shows Mainnet as Coming soon and the
worker logs `Arc Mainnet off: …` once at start and skips mainnet campaigns (none can exist yet).

1. **Circle production key.** In the Circle Console (production), create an API key. It starts with `LIVE_API_KEY:`.
   Put it in the root `.env` as `CIRCLE_LIVE_API_KEY` (never in `CIRCLE_API_KEY`).
2. **Entity secret.** The worker uses `CIRCLE_MAINNET_ENTITY_SECRET`, else `CIRCLE_ENTITY_SECRET`. If Circle says the
   secret isn't registered for production, run the setup with `--new-entity-secret`: it generates one, registers it
   and saves the recovery file in `~/misthos-circle-recovery-mainnet/` (back it up).
3. **Agent wallet.** `pnpm --filter @misthos/worker circle:setup:mainnet -- --confirm-mainnet` creates the wallet set
   `misthos-agent-mainnet` with one SCA on `ARC`, writes `CIRCLE_MAINNET_AGENT_WALLET_ID` and
   `CIRCLE_MAINNET_AGENT_WALLET_ADDRESS` to `.env`, and deploys the SCA with one sponsored no-op call (Circle won't sign
   from an undeployed SCA). Idempotent.
4. **Gas Station.** In the Circle Console (production) → Gas Station, create a policy for `ARC` that sponsors the
   agent's wallet set, with a daily spend cap, and add billing. Without it the SCA can't pay gas (step 3 fails at the
   deploy call).
5. **Railway (worker)** — add: `CIRCLE_LIVE_API_KEY`, `CIRCLE_MAINNET_AGENT_WALLET_ID`,
   `CIRCLE_MAINNET_AGENT_WALLET_ADDRESS`, and `CIRCLE_MAINNET_ENTITY_SECRET` if you made a separate one;
   optionally `ARC_MAINNET_RPC_URL`. Keep `NEXT_PUBLIC_CHAIN=arc-testnet` (the worker refuses `arc-mainnet` there).
   The log line `worker ready` lists `networks: ["arc-testnet","arc-mainnet"]`.
6. **Vercel (web)** — add only the public address: `CIRCLE_MAINNET_AGENT_WALLET_ADDRESS` (optionally
   `ARC_MAINNET_RPC_URL`). The web app never holds a Circle key.
7. **Smoke test** with a few dollars: create a mainnet campaign (keep the safe limits), deploy the vault, deposit e.g.
   2 USDC, join with a second wallet, submit, close the round, approve it, check the payout on explorer.arc.io and
   Verify the decision on the public audit page. Then withdraw what's left if it was only a test.

## Safe starting limits (the wizard's mainnet suggestion)

| Limit                            | Mainnet suggestion      | Why                                              |
| -------------------------------- | ----------------------- | ------------------------------------------------ |
| Max per contributor per round    | ≤ 5 USDC                | a mistake costs little                           |
| Max per round                    | ≤ 25 USDC               | bounds one round                                 |
| Max per rolling 24 hours         | ≤ 25 USDC               | bounds a compromised agent to 25 USDC a day      |
| Owner approval needed above      | 0 USDC: **every round** | nothing is paid until you approve the round      |
| New payout wallet cooldown       | 24 hours                | a hijacked X account can't redirect payouts fast |
| Largest item paid without review | ≤ the per-payout cap    | bigger items wait for you                        |

The vault enforces these on-chain; the agent can't exceed them. Raise them in Settings (an owner transaction) once you
trust the campaign's flow.

## Security model

- **The owner holds the funds.** Each campaign's vault is an EIP-1167 clone owned by the campaign owner's wallet; only
  the owner can deposit, withdraw, pause or change limits. Mainnet vaults come only from the mainnet factory.
- **Separate agents per network.** The mainnet agent is its own Circle SCA under the LIVE key. The testnet key, testnet
  wallet and the testnet EOA fallback can never act on mainnet: the worker's primary network must be Arc Testnet, the
  mainnet agent comes only from the `CIRCLE_LIVE_*` / `CIRCLE_MAINNET_*` variables, and a mainnet wallet id or address
  equal to the testnet one is refused.
- **Nothing reaches mainnet without its variables.** Missing, partial or invalid mainnet values turn mainnet off (one
  warning naming the variables, never their values); the worker still starts and serves testnet as before; mainnet jobs
  are skipped with a log line and their rows stay untouched; due rounds and stuck work are only picked up for networks
  the worker serves. The web app offers Mainnet in the wizard only with both the factory and the agent address set.
- **Every job on its program's network.** Each job looks up its program's network and gets that network's reader,
  executor, signer and chain id. The agent re-checks it (`onProgramNetwork`) before claiming a submission, locking a
  round, registering a payee, signing or sending anything; a mismatch changes nothing.
- **Signed for one chain.** Decision records carry the chain id and are signed by that network's agent. Verify accepts a
  record only on its campaign's network; the signature check, the factory check (CREATE2 prediction) and the agent read
  all run there.
- **Wallet prompts.** Every owner transaction is pinned to the campaign's chain id; the wallet is asked to switch or add
  the network first. The faucet link appears only on testnet; funding screens on mainnet say "real USDC".

## Testing without real money

`ARC_MAINNET_FORK=1 pnpm --filter @misthos/web test:mainnet-fork` runs the whole loop on a local Anvil fork of Arc
Mainnet: the real mainnet factory and template, the USDC address, the web server's chain checks, the worker's network
routing, Circle executor/signer and round job, and Verify on Arc Mainnet. Two stand-ins, both test-only: Anvil can't
run Arc's native USDC precompile, so the code at `0x3600…` is swapped for a 6-decimal test token (`ForkUsdcStub`), and
the Circle LIVE client is `CircleLiveClientStub` (a generated test key; it logs that it's in use). Nothing is broadcast
to Arc Mainnet.
