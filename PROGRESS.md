# Misthos — Progress

**Current phase:** 2 (Data + auth) complete; awaiting go-ahead for Phase 3 (agent core).
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

## Done (Phase 2 — Data + auth)

- **DB (`packages/db`)**: Drizzle schema for users, auth_nonces, programs, program_members, contributors, rounds,
  submissions, fetched_resources, decisions, payouts, audit_events, api_usage. Money = bigint 6-dec base units.
  Migrations checked in (`0000_init`, `0001_pg_trgm_and_audit_guard`) and **applied to Neon** (PG 18):
  `pg_trgm` + GIN trigram index on `fetched_resources.content_text`; `audit_events` append-only via triggers
  (UPDATE/DELETE/TRUNCATE raise). Uniques: one membership per X account per program, one payout wallet per program,
  one submission per contributor per resource (cross-contributor duplicates kept for flagging). `pnpm --filter
@misthos/db db:migrate`. Pool size via `DB_POOL_MAX`.
- **Signatures (`@misthos/shared` `verifyWalletSignature`)**: viem ERC-6492 universal validator → EOA ecrecover and
  ERC-1271 `isValidSignature`. Proven live on Arc testnet against `MockERC1271Wallet`
  `0x0567059B08CFF857c703e137DCE4a5efab1954f8` (owner = deployer) — `ARC_RPC_TESTS=1` suite, fixture in
  `packages/shared/test/fixtures/arc-signatures.json`.
- **Owner auth**: SIWE (EIP-4361). Checks domain, URI origin, chain, ≤10 min age, signature (EOA/1271), then consumes
  a single-use DB nonce (atomic UPDATE). HS256 JWT in httpOnly SameSite=Lax cookie; separate owner/contributor
  sessions. All POST routes require same-origin `Origin`.
- **Contributor auth**: X OAuth 2.0 PKCE (S256), confidential client, endpoints verified on docs.x.com. Scopes
  `tweet.read users.read` only; token revoked right after `GET /2/users/me` (never stored); `api_usage` row per call.
  Redirect targets restricted to same-origin paths.
- **Wallet link**: server issues the exact message (program, X id + handle, wallet, chain, nonce, time); server
  rebuilds it on verify, checks signature before burning the nonce, stores message + signature as proof. Wallet
  change sets `wallet_changed_at` + `contributor.wallet_changed` audit event; UI shows cooldown and an owner-side flag.
- **UI**: ConnectKit (React 19 verified in a real browser; Aave option off; WalletConnect client-only singleton),
  `/app` sign-in gate + programs list, 4-step wizard (Basics → Rubric → Budget & limits → Review; vault limits
  validated like the contract), program page (publish/pause, join link, rubric, limits, contributors),
  `/join/[slug]`, `/c/[slug]` (account, wallet change). Draft programs have no public page.
- **Tests**: shared 19 (+4 live), db 6 (PGlite, migrated template cloned per test), web 32 (SIWE edge cases, PKCE /
  token / revoke / users-me with fixtures, open-redirect, program + wallet-link domain logic on PGlite).
  **Browser e2e** (`pnpm --filter @misthos/web e2e`): injected EIP-1193/EIP-6963 test wallet + throwaway in-memory
  Postgres (PGlite socket server; Neon untouched). Owner SIWE → wizard (incl. limit validation) → publish →
  contributor joins with signed proof → switches wallet → owner sees flag; asserts DB rows, exact audit trail, all
  nonces consumed once, and that audit_events rejects UPDATE. X OAuth is simulated in e2e by issuing the session
  the callback would (the OAuth code is unit-tested).

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
  `ALLOW_MAINNET=true`), `CreateVault.s.sol` (smoke vault only, owner = agent = deployer), `script/smoke.sh`
  (`fund` / `register` / `pay` via `cast send`; `pay` also asserts the exact `PayoutTooLarge` and
  `RoundNotExecutable` reverts on-chain).
- `@misthos/shared` exports `DEPLOYMENTS` / `getDeployment(chain)`.
- Secrets moved from `.env.example` to `.env` (gitignored, verified). Testnet-only deployer generated:
  `0xb2d469d1092308378710A5365105Ec9A7F6A33d2` (key only in `.env`).

## Arc testnet deployment (2026-10-02, chain 5042002)

| Contract                          | Address                                      | Status                                                                                                                         |
| --------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| MisthosVault (implementation)     | `0xbB016FeB193c9F1151e77444a2145c5dfAA965D7` | [verified](https://explorer.testnet.arc.io/address/0xbB016FeB193c9F1151e77444a2145c5dfAA965D7)                                 |
| MisthosVaultFactory               | `0x19afd6fCeb49A333B3b3b455A26e6ee43db8849b` | [verified](https://explorer.testnet.arc.io/address/0x19afd6fCeb49A333B3b3b455A26e6ee43db8849b)                                 |
| Smoke vault (EIP-1167 clone)      | `0x49cd73fC60f61A3eb1a8194effdC6FD88035fBa9` | [clone → impl](https://explorer.testnet.arc.io/address/0x49cd73fC60f61A3eb1a8194effdC6FD88035fBa9), 3 USDC left after 2 rounds |
| Deployer (owner + agent of smoke) | `0xb2d469d1092308378710A5365105Ec9A7F6A33d2` | testnet-only EOA, key in `.env`                                                                                                |

Smoke rounds (1 USDC each, payee = deployer): execute txs
[0x2e1f…aaac](https://explorer.testnet.arc.io/tx/0x2e1fe69ea476d88768e58fe0905609bf1d3cb05955d1724a04527c3f0ab0baac),
[0x91cb…cf3b](https://explorer.testnet.arc.io/tx/0x91cb6ae4e6412a0b3a04ab1acd97486289978cf70ca4c3c2ab66660ad152cf3b).
`PayoutExecuted` carries amount + decisionHash as expected. Over-cap proposal reverted with `PayoutTooLarge`;
re-execution reverted with `RoundNotExecutable`.

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

## Owner checklist (only you can do these)

- [ ] X developer portal → app → User authentication settings: callback URL
      `http://localhost:3000/api/auth/x/callback` (and the production URL once deployed); type "Web App"
      (confidential client). Until then Sign in with X fails at X.
- [ ] `ANTHROPIC_API_KEY` in `.env` (Phase 3 uses fixtures; needed for live scoring).
- [ ] Circle entity secret + agent wallet (payout phase, together).

## Next (Phase 3 — Agent core)

URL classify → fetchers (X v2 tweet lookup, GitHub PR via public API + token, article via readability) with caching
and `api_usage` → deterministic flags (ownership, window, duplicate, near-duplicate SimHash + pg_trgm, account age,
engagement anomaly, not merged, prompt injection) → LLM judge (Haiku 4.5, tool-schema output, fixtures in tests) →
decision engine → canonical decision record + keccak hash + signature. Submission box on `/c/[slug]`.

## Stubs

None. `/c/[slug]` says submissions open with the agent pipeline (Phase 3); no fake data anywhere.

## Known issues

- `apps/web/AGENTS.md` / `CLAUDE.md` are regenerated by `next dev`; keep them committed.
- Stock Foundry can't execute Arc USDC transfers on a fork: `0x3600…` calls the native precompile
  `0x1800…0001::isBlocklisted`, which revm doesn't implement. Fork tests cover decimals/native-view/native-revert;
  the real-USDC lifecycle is proven on-chain by `script/smoke.sh`. The same limitation means **any `forge script`
  that moves USDC fails in local pre-execution** — use `cast send` / viem for USDC-moving transactions.
- Arc emits an extra `Transfer` log from system address `0xffff…fffe` alongside the USDC `Transfer` from `0x3600…`.
  Indexers must key on the vault's `PayoutExecuted` event, not raw `Transfer` logs.
- Blockscout labels the factory `basic_implementation` (because of its `implementation()` getter) and forge's
  "already verified" check is fooled by it; verify with `--skip-is-verified-check`. Don't pass `--watch` with
  forge 1.7.1 here (CLI parse error).
- forge-lint reports 3 `block-timestamp` warnings in `MisthosVault` — intentional (hour-scale cooldown / 24h window).
- e2e needs Chromium (`pnpm --filter @misthos/web exec playwright install chromium`) and isn't in CI yet (Phase 8).
- No rate limiting on public endpoints yet (Phase 8 security pass). Nonce table is cleaned opportunistically.
- `next dev` with `NEXT_DIST_DIR=.next-e2e` adds `.next-e2e` type paths to `apps/web/tsconfig.json`; harmless.
- Circle agent wallet not created yet (`CIRCLE_ENTITY_SECRET`, `CIRCLE_AGENT_WALLET_ID` empty) — set up together
  in the payout phase; then `setAgent` on vaults.
