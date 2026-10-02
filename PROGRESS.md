# Misthos — Progress

**Current phase:** 1 (Contracts) — code + tests complete; testnet deploy waiting on deployer funding.
**Last updated:** 2026-10-02
**Deadline:** Oct 10, 2026 11:59 PM ET

## Reduced scope (owner decision, 2026-10-02)

- **Keep:** vault + tests + testnet deploy, program setup, X sign-in + wallet signature, submissions (X posts,
  GitHub PRs via public API, articles), agent pipeline (fetch, deterministic checks, LLM scoring, prompt-injection
  defense, decision engine, signed decision records), review queue, testnet payout rounds, public audit page with
  "Verify a decision", simple landing page, short docs, metrics page.
- **Cut:** GitHub OAuth (contributor types their GitHub username), treasury/USYC, CCTP, EURC, keyboard shortcuts,
  notifications, Discord/YouTube.
- Phase 3 tests use saved fixtures (no API spend). Both agent models: `claude-haiku-4-5-20251001`.

## Decisions (confirmed 2026-10-02)

1. Agent executor = Circle smart-contract wallet on Arc testnet. Decision signatures must verify for **both**
   ERC-1271 (SCA) and EOA signers (viem `verifyMessage` covers both).
2. Neon (Postgres) + Railway (worker) + ConnectKit.
3. `~/CLAUDE.md` Latch API-routing rule does not apply to this project; secrets come from root `.env`
   (gitignored, never committed or logged). Mainnet deploys and real funds need explicit owner OK.

## Done (Phase 1 — Contracts)

- `MisthosVault` (EIP-1167 clone, `Initializable`, `ReentrancyGuard`, SafeERC20, custom errors, NatSpec):
  roles owner/agent/guardian; limits `maxPerPayout`, `maxPerRound`, `maxPerDay` (true rolling 24h via a pruned
  outflow log), `autoApproveThreshold`, `payeeCooldown`; `registerPayee` (every register/change starts cooldown,
  `PayeeChanged` on change); `proposeRound` / `approveRound` / `cancelRound` / `executeRound`; `paid[payoutId]`
  idempotency; `deposit` (tracked) + owner `withdraw` (works while paused); `MAX_PAYOUTS_PER_ROUND = 200`.
  Execution **re-validates** every payout against current limits and payees, so a wallet swap or a tightened limit
  after proposal blocks execution.
- `MisthosVaultFactory`: `createVault(programId, owner, agent, guardian, limits)`, deterministic per
  (caller, programId) so vault addresses can't be squatted; `predictVaultAddress`.
- Tests (`forge test`): 68 unit (every function + revert path), 3 fuzz × 1024 runs (payout/round caps, rolling daily
  cap vs independent recomputation, cooldown), 5 invariants × 256 runs × 64 depth (paid+withdrawn ≤ deposited,
  exact balance accounting, payoutId paid at most once, strangers can't move funds, caps hold). Handler reachability
  of propose/execute was probed and confirmed (invariants aren't vacuous). Fork suite (3 tests, opt-in via
  `ARC_FORK_RPC`) passes against live Arc testnet.
- Scripts: `Deploy.s.sol` (impl + factory → `packages/shared/src/deployments.json`; refuses chain 5042 unless
  `ALLOW_MAINNET=true`), `CreateVault.s.sol` (smoke vault, owner = agent = deployer, funds 5 USDC),
  `SmokeRound.s.sol` (`register()` then `pay()` after the 2-min cooldown: a real 1 USDC round).
  Deploy simulated successfully against live testnet: ~3.0M gas ≈ 0.15 USDC.
- `@misthos/shared` exports `DEPLOYMENTS` / `getDeployment(chain)`.
- Secrets moved from `.env.example` to `.env` (gitignored, verified). Testnet-only deployer generated:
  `0xb2d469d1092308378710A5365105Ec9A7F6A33d2` (key only in `.env`).

## Phase 1 remaining (blocked on owner)

1. Fund `0xb2d469d1092308378710A5365105Ec9A7F6A33d2` from faucet.circle.com (Arc Testnet, ~20 USDC).
2. Then (from `packages/contracts`, with `DEPLOYER_PRIVATE_KEY` exported from `.env`):
   `forge script script/Deploy.s.sol --rpc-url arc_testnet --broadcast` →
   `forge script script/CreateVault.s.sol --rpc-url arc_testnet --broadcast` →
   `SmokeRound register()` → wait 2 min → `SmokeRound pay()`. Then verify on the explorer and commit.

## Done (Phase 0)

## Done (Phase 0)

- pnpm + Turborepo monorepo: `apps/web`, `apps/worker`, `packages/{shared,agent,db,contracts}`.
- `apps/web`: Next.js 16.3 (App Router, Turbopack), TS strict, Tailwind v4, shadcn/ui (Radix, Nova preset),
  next-themes (light/dark/system), Geist Sans/Mono, design tokens (zinc + deep emerald, semantic state colors),
  primitives: `Money`, `HexValue` (copy + explorer), `StatusBadge`, `Wordmark`, `ThemeToggle`, `/api/health`.
- `packages/shared`: `chains.ts` with every Arc/Circle value cited and verified against live RPC;
  USDC `parseUsdc`/`formatUsdc`/`shortHex` (bigint, 6-decimal ERC-20 units). 7 Vitest tests.
- `packages/contracts`: Foundry (solc 0.8.28), OpenZeppelin 5.6.1 + forge-std via npm. Smoke test passes.
- `apps/worker`: pino logger boot. CI: typecheck, lint, test, forge test, web build.

## Verified facts (see `packages/shared/src/chains.ts` for citations)

| Fact                                                                            | Value                                                                                  | Source                                                |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Testnet chain ID                                                                | 5042002 (`eth_chainId` → `0x4cef52`)                                                   | docs.arc.io connect-to-arc + live RPC                 |
| Mainnet chain ID                                                                | 5042 (`eth_chainId` → `0x13b2`) — **mainnet is live**                                  | docs.arc.io + live RPC                                |
| RPC                                                                             | `rpc.testnet.arc.io`, `rpc.mainnet.arc.io`                                             | docs.arc.io                                           |
| Explorer                                                                        | `explorer.testnet.arc.io`, `explorer.arc.io`                                           | docs.arc.io                                           |
| USDC                                                                            | `0x3600…0000` both nets. Native = 18 dec, ERC-20 view = 6 dec, **same balance**        | contract-addresses, evm-differences; `decimals()` → 6 |
| USYC                                                                            | Permissioned: allowlisting + $100k minimum                                             | contract-addresses                                    |
| Circle Dev-Controlled Wallets, Contracts, Agent Wallets, Gas Station, Paymaster | **Arc Testnet only**                                                                   | developers.circle.com supported-blockchains pages     |
| Local EVM sim                                                                   | Plain `anvil` doesn't model Arc; use `arc-anvil` (circlefin/arc-foundry) or fork tests | evm-differences                                       |

## Architecture plan

```
 Owner (ConnectKit wallet) ──► apps/web (Next.js on Vercel) ◄── Contributor (X OAuth + wallet sig)
                                   │  server actions / route handlers (zod + authz)
                                   ▼
                            Postgres (Neon, pg_trgm) ◄──── pg-boss queue ────► apps/worker (Railway)
                                                                                 │ packages/agent
                                                                                 │  fetch → checks → Claude judge
                                                                                 │  → decision engine → signed record
                                                                                 ▼
                             Circle Dev-Controlled Wallet (agent) ──► MisthosVault (EIP-1167 clone) on Arc
                                                                         enforces caps, cooldown, idempotency
                                   Public audit page ◄── DB records + PayoutExecuted(decisionHash) events
```

- **Money math:** everything in 6-decimal ERC-20 USDC units (`bigint`). The vault uses `IERC20(0x3600…)` with
  SafeERC20 and has no `receive()`, so native transfers to it revert. The 18-decimal native value is only used for gas.
- **Vault:** as specified in §5, plus `Payout.amount` in ERC-20 units and `payoutId = keccak256(programId, roundId, contributorId)`.
  Tests: unit, fuzz, invariant (Foundry), plus a fork test against Arc testnet for the real USDC precompile behavior.
- **Agent executor:** Circle Dev-Controlled Wallet on `ARC-TESTNET`, calling the vault via
  `createContractExecutionTransaction` (`@circle-fin/developer-controlled-wallets`). Decision records signed via
  the wallet's `signMessage` (EIP-191).
- **Circle tools map:** USDC (settlement), Dev-Controlled Wallets (agent), Gas Station/Paymaster (sponsor agent gas
  on testnet), Contracts (event monitoring, optional), CCTP/Bridge Kit (stretch), EURC (stretch).
  USYC is an **IdleStrategy only** plan unless we get allowlisted.

## Open decisions (need owner input before Phase 1)

1. **Mainnet agent key.** Circle wallets don't support Arc mainnet yet. Options:
   (a) testnet = Circle wallet, mainnet = dedicated EOA key in the worker's secret store, with small on-chain vault caps
   limiting the blast radius _(recommended)_; (b) stay testnet-only and skip the mainnet deploy.
2. **Signature type.** If the agent wallet is an SCA (needed for Gas Station sponsorship), `signMessage` gives an
   ERC-1271 signature, which is verified with an `isValidSignature` call and not by `ecrecover`. viem's `verifyMessage`
   handles both. Recommended: SCA for execution + EIP-1271 verification in the "Verify a decision" tool.
   To confirm in Phase 1 against the live API.
3. **Infra choices:** Neon (Postgres) + Railway (worker) + ConnectKit (Arc docs ship a ConnectKit example;
   WalletConnect doesn't register Arc testnet) _(recommended)_.

## Next (Phase 2 — Data + auth)

Drizzle schema + migrations on Neon, owner wallet auth (SIWE-style), X OAuth 2.0 PKCE for contributors, wallet
ownership signature, GitHub username field (no OAuth), program wizard (without chain), join flow.

## Stubs

None. (`packages/agent` and `packages/db` only export a name constant until Phases 2–3.)

## Known issues

- `apps/web/AGENTS.md` / `CLAUDE.md` are regenerated by `next dev`; keep them committed.
- Stock Foundry can't execute Arc USDC transfers on a fork: `0x3600…` calls the native precompile
  `0x1800…0001::isBlocklisted`, which revm doesn't implement. Fork tests cover decimals/native-view/native-revert;
  the real-USDC lifecycle is proven on-chain by `SmokeRound.s.sol`.
- forge-lint reports 3 `block-timestamp` warnings in `MisthosVault` — intentional (hour-scale cooldown / 24h window).
- Circle agent wallet not created yet (`CIRCLE_ENTITY_SECRET`, `CIRCLE_AGENT_WALLET_ID` empty) — set up together
  in the payout phase; then `setAgent` on vaults.
