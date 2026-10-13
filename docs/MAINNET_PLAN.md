# Arc Mainnet support — plan and log

Branch: `mainnet`. Deadline: Oct 17, 2026 11:59 PM ET.

## Go-live (2026-10-13, with the owner's explicit approval)

- **Circle production:** the owner's LIVE key and an ARC Gas Station policy ($2/day, $0.50/tx, 100 tx/day). Circle had no
  production entity secret, so a separate one was registered (`CIRCLE_MAINNET_ENTITY_SECRET`); its recovery file is in
  `~/misthos-circle-recovery-mainnet/` (dir 700, file 600), outside the repo.
- **Mainnet agent:** SCA `0xea208f9c9a7f06fff8a4c4afa8bddaa23d3c1f8c` (ARC, LIVE), deployed by a sponsored no-op call,
  tx `0xe87923033a6653202e7658b62a0cb271d596ff17636f245d940e0d0affbd55ed`. USDC balance 0. Deployer untouched (nonce 2).
- **Env:** Railway worker: `CIRCLE_LIVE_API_KEY`, `CIRCLE_MAINNET_ENTITY_SECRET`, `CIRCLE_MAINNET_AGENT_WALLET_ID`,
  `CIRCLE_MAINNET_AGENT_WALLET_ADDRESS` (set via stdin, checked by hash). Vercel Production:
  `CIRCLE_MAINNET_AGENT_WALLET_ADDRESS` only. `NEXT_PUBLIC_CHAIN` stays `arc-testnet` on both.
- **Shipped:** `main` fast-forwarded 58e9615 → 0a72c1d; Vercel built from the push; worker via `railway up`. No migration.
- **Production checks:** worker log `networks=["arc-testnet","arc-mainnet"]`, no "Arc Mainnet off", no warnings; worker
  health ok. Pages 200; X sign-in redirects to x.com with the production callback; SIWE nonce 200. Verify on two live
  testnet records gives identical results before and after (one full on-chain payout match). Mainnet offered at runtime.
- **Known quirk:** Turbo's strict env mode hides `CIRCLE_MAINNET_AGENT_WALLET_ADDRESS` from the build, so the
  prerendered landing page shows "mainnet off" copy for up to 5 minutes after each deploy, until ISR revalidates.
  Dynamic pages (wizard, server actions) are unaffected. Fix: add the name to `globalEnv` in `turbo.json`.
- **Next:** the owner's mainnet smoke test (they deposit from their own wallet).

## Morning report (2026-10-13)

**1. Built and tested.** Everything in the brief is built on `mainnet`, except creating the mainnet agent wallet
(hard stop). Arc Mainnet stays "Coming soon" until that wallet exists.

- **Network switch:** header switch (Testnet / Mainnet, remembered, default Testnet). Every page has a badge; on a
  campaign's pages it shows that campaign's network. Lists, `/c`, "See it live", landing numbers and metrics follow it.
- **Wizard:** network picker with confirmation and safe mainnet limits; "Coming soon" when mainnet isn't configured.
- **Campaign pages and wallets:** every on-chain read, check, wallet action and explorer link uses the campaign's
  network, and owner transactions ask the wallet to switch to or add it.
- **Worker:** two Circle clients and two agent wallets; every job runs on its program's network. If the mainnet
  variables are missing, the worker starts normally and skips mainnet programs with a log line.
- **Verify:** checks records on their own network.
- **Metrics and copy:** metrics split everywhere, including the copy text; real vs test USDC wording, faucet only on
  testnet.
- **Docs:** `docs/MAINNET.md`, `.env.example`.

Tests:

| Suite                                                                         | Result                                                                                                                                                               |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit: shared                                                                  | 49 passed (+4 live tests skipped)                                                                                                                                    |
| Unit: db                                                                      | 12 passed                                                                                                                                                            |
| Unit: agent                                                                   | 215 passed (+1 skipped)                                                                                                                                              |
| Unit: worker                                                                  | 30 passed                                                                                                                                                            |
| Unit: web                                                                     | 173 passed (+1 opt-in fork test, skipped by default)                                                                                                                 |
| Contracts                                                                     | 90 passed (+1 skipped)                                                                                                                                               |
| Fork loop (`ARC_MAINNET_FORK=1 pnpm --filter @misthos/web test:mainnet-fork`) | 1/1                                                                                                                                                                  |
| e2e (both networks, incl. two axe tests in both themes)                       | **33/33** on a production build (main server with mainnet off + a second server with a mainnet agent); axe: 0 serious/critical on every scanned page, light and dark |
| Lighthouse mobile                                                             | landing 92, sign-in 92, program overview 91 (desktop 100); `docs/perf/lighthouse-mainnet-branch.json`                                                                |

- **Fork loop scope:** deploy from the real mainnet factory → fund → signed decision for chain 5042 → payee →
  propose → owner approval → execute → Verify on Arc Mainnet.
- **Security review:** an independent review found no Critical or High issues. Low items fixed: the worker checks the
  mainnet RPC chain id and the Circle wallet (ARC, matching address) before serving mainnet; mainnet idempotency keys
  are network-prefixed; the reprocess script routes each submission by network. The rest are listed in `docs/MAINNET.md`
  under "Known limits".

**2. Mainnet contracts:** deployed 2026-10-10 and not redeployed; verified on-chain tonight.

- MisthosVault template: `0x36E677De57Ce0f59eFed05a748B07c7Bb07d5dBb`
  (tx `0x336c7fc4d57cc56c1923ac1842a4c16e964284926fec535092372d2f34836476`)
- MisthosVaultFactory: `0x9075CbB50639216C2e4E32013514baa01f2b0C1b`
  (tx `0x430aedcedc4ce351843ed14cbf74565b93d66cb625f6c580fd78fb61a80f05a0`)
- Deployer `0x6B48…fdff`: **0.453901 USDC** left, nonce 2, so no other transaction was ever sent from it. Nothing
  else touched mainnet tonight.

**3. Preview:** https://misthos-git-mainnet-kenils-projects-a3f732d1.vercel.app

- Vercel builds it automatically from this branch. It's behind Vercel Authentication, so log in to Vercel to open it.
- The landing page and docs work. App pages don't, because every Vercel env var is scoped to Production only; I didn't
  change any settings.
- For a working preview, add Preview-scoped variables pointing at a throwaway database (e.g. a Neon branch, never
  production): `DATABASE_URL`, `SESSION_SECRET`, `X_CLIENT_ID`, `X_CLIENT_SECRET`, `NEXT_PUBLIC_CHAIN=arc-testnet`,
  `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`, `CIRCLE_AGENT_WALLET_ADDRESS`. No mainnet secrets.

**4. What you do next, in order:**

1. **Circle LIVE key.** Create a production API key in the Circle Console and put it in the root `.env` as
   `CIRCLE_LIVE_API_KEY` (it starts with `LIVE_API_KEY:`).
2. **Agent wallet.** Run `pnpm --filter @misthos/worker circle:setup:mainnet -- --confirm-mainnet`. Add
   `--new-entity-secret` if Circle says the entity secret isn't registered for production. It writes
   `CIRCLE_MAINNET_AGENT_WALLET_ID` and `CIRCLE_MAINNET_AGENT_WALLET_ADDRESS` to `.env` and deploys the SCA with one
   sponsored call.
3. **Gas Station.** Before step 2's deploy call can succeed: Circle Console (production) → Gas Station → a policy for
   `ARC` covering the agent's wallet set, with a daily cap and billing.
4. **Railway (worker)** env: `CIRCLE_LIVE_API_KEY`, `CIRCLE_MAINNET_AGENT_WALLET_ID`,
   `CIRCLE_MAINNET_AGENT_WALLET_ADDRESS` (+ `CIRCLE_MAINNET_ENTITY_SECRET` if you made one). Keep
   `NEXT_PUBLIC_CHAIN=arc-testnet`.
5. **Vercel (web)** env: `CIRCLE_MAINNET_AGENT_WALLET_ADDRESS` only.
6. **Merge and deploy:** review, merge `mainnet` → `main` yourself, then deploy as usual (`git push` for Vercel,
   `railway up` for the worker; no database migration needed). Check that the worker log says
   `networks: ["arc-testnet","arc-mainnet"]` and has no "Arc Mainnet off" line.
7. **Smoke test with a few USDC:**
   - Create a mainnet campaign with the safe limits, deploy the vault, deposit ~2 USDC.
   - Join with a second wallet and submit something.
   - Close the round and approve it (every round needs you).
   - Check the payout on explorer.arc.io, Verify it on the public audit page, then withdraw the rest.

**Blocked:** only the hard stops: the mainnet agent wallet (needs your LIVE key), any other mainnet transaction, and
merging or deploying.

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

- Shared `networkConfig(chain)`: chain id, RPC, explorer, USDC, factory/template, Circle blockchain, agent wallet.
- Header network switch (cookie `misthos_network` + localStorage fallback, default Testnet, applied before paint by an
  inline script in `<body>`); badge on every page (campaign pages show the campaign's network). Owner list, switcher,
  Needs you, `/c` (+ card badges, "Earned on …"), landing "See it live" + numbers follow it; empty states offer the
  other network.
- Wizard: Mainnet "Coming soon" when not configured; mainnet confirmation; safe limits (≤5/25/25 USDC, threshold 0 =
  every round needs the owner) with "Use the safe limits".
- Join / contributor / public audit pages show the network; wallet-link on mainnet switches the wallet to Arc Mainnet
  first and the message adds "Network: Arc Mainnet (real USDC)" (testnet message byte-identical, tested).
- Verify: record chainId must equal the campaign's network before any chain read (tests incl. a genuine signed record
  naming the other network).
- Metrics: both networks side by side; Copy for submission form reports them apart (tested).
- Copy: real vs test USDC on funding screens, faucet only on testnet; FAQ/footer mention mainnet only when it's open.
- `.env.example`, `docs/MAINNET.md`, guardrails docs list mainnet contracts; deadline Oct 17 in PROGRESS/PROMPT.
- Fork loop (`ARC_MAINNET_FORK=1 pnpm --filter @misthos/web test:mainnet-fork`): passes — deploy from the real
  mainnet factory, fund, signed decision (chain 5042), payee, propose, owner approval, execute, Verify on mainnet.
- e2e: `networks.spec.ts` (switch, Coming soon, mainnet wizard on a second server, badges, lists, wrong-network
  add+switch) and a second axe test over every network-affected page in both themes.

- Lighthouse (mobile ≥ 90 on landing, sign-in, overview), independent security review (no Critical/High; Lows fixed
  or documented), morning report.

### Left

- Nothing in scope. Follow-ups (not blocking): chain-scoped owner sessions for contract signers; the worker publishing
  its served networks so the web app can gate Mainnet on it (see `docs/MAINNET.md` → Known limits).

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
- D8 Mainnet safe limits (wizard suggestion, not enforced): per payout ≤ 5, per round ≤ 25, per day ≤ 25 USDC, never
  above the rubric-derived testnet numbers; auto-approve threshold 0 so every round waits for the owner.
- D9 Fork test: Anvil can't run Arc's native USDC precompile (`0x1800…0000::transfer`), so on the local fork only the
  code at `0x3600…` is replaced by `ForkUsdcStub` (6-dec ERC-20). Factory and template are mainnet's real code. The
  Circle LIVE client is `CircleLiveClientStub` (test-only, logs itself). The test lives in apps/web (Verify and the
  server chain code are there) and imports the worker's code by path.
- D10 Testnet stays the same: testnet copy unchanged except the wizard/join wording that now says "test USDC"
  explicitly; testnet wallet-link message unchanged; connect-time network switch unchanged (switches to the page's
  network); contributors on testnet campaigns are never asked to switch before signing.
- D11 The header switch never changes what a campaign is: campaign pages always use the campaign's own network; the
  switch only filters lists and public summaries. The cookie is only a display preference (parsed to one of two keys).
- D12 e2e runs a second `next start` (:3101) from the same build with a chain-free mainnet agent address, so both
  "Coming soon" and the enabled mainnet wizard are tested; the e2e PGlite server allows 3 connections.
- D13 e2e `navigation.spec.ts` (sign-out): it now waits for the wallet chip to reach "Wallet ready" before opening the
  account menu. Under full-suite load the chip remounted when its wallet code loaded and closed the open menu (an
  existing test race, not a product change). The e2e database must be fresh per full run (two specs use fixed slugs).
- D7 Unit tests run with `--concurrency=1` across packages: in parallel, PGlite-heavy suites time out on this machine
  (not failures in the code; each package passes alone).
