# Misthos

**Contributor payroll, run by an agent you can audit.**

Misthos verifies contributor work, catches fraud, and pays in USDC on Arc, inside limits enforced on-chain.
Contributors submit links to their posts, pull requests and articles. An AI agent checks that the work is theirs,
original and inside the round, scores it against the program's rubric, and explains its decision. Payouts go out
from a vault contract whose limits the agent cannot exceed, and every decision is a signed record anyone can verify
against the chain.

**Live on Arc testnet: https://misthos-iota.vercel.app** · [Docs](https://misthos-iota.vercel.app/docs) ·
[A real program's audit page](https://misthos-iota.vercel.app/p/kency-arc-creators)

Built for the Tameion Agents Hackathon (Canteen × Circle × Arc). Status and decisions: [PROGRESS.md](./PROGRESS.md).

![Public audit page with a verified decision](docs/screenshots/public-verify-light.png)

## Try it in 2 minutes

No account, no keys. You need [Foundry](https://getfoundry.sh) (`cast`) for step 2 and Node 22 + pnpm for step 3.

1. **See money move under the vault's rules (30 s).** Open the [live-round vault](https://explorer.testnet.arc.io/address/0x09138198c0056189727dfe809E67934c1B7fD973)
   on the Arc explorer: every `PayoutExecuted` event carries the `decisionHash` of the signed records it paid.
2. **Check a decision signature yourself (30 s).** [`docs/examples/decision.json`](docs/examples/decision.json)
   is a canonical decision record (an example, not a real submission) signed by the real agent wallet, a Circle
   smart-contract account. From the repo root:

   ```bash
   cd docs/examples
   H=$(cast keccak "$(cat decision.json)")      # the decision hash: 0x40d2040e…027072
   D=$(cast keccak "$(cast concat-hex "$(cast from-utf8 $'\x19Ethereum Signed Message:\n32')" "$H")")
   cast call 0x74a60caa5e6c14a33be4ebf1507a209ac61b78a1 "isValidSignature(bytes32,bytes)(bytes4)" \
     "$D" "$(cat decision.sig)" --rpc-url https://rpc.testnet.arc.io
   # 0x1626ba7e = valid (ERC-1271). Change one byte of decision.json and it isn't.
   ```

3. **Run the guarantees (1 min).** The vault's caps, cooldowns and exactly-once payouts (unit, fuzz, invariant, gas),
   and every flag and decision rule against adversarial fixtures, including a recorded real X thread:

   ```bash
   pnpm install && pnpm --filter @misthos/contracts test && pnpm --filter @misthos/agent test
   ```

Then try the live app at **https://misthos-iota.vercel.app** (Arc testnet):

1. **Public audit page** [`/p/kency-arc-creators`](https://misthos-iota.vercel.app/p/kency-arc-creators): totals, every
   payout with its transaction, and the agent's reasons. Its first round paid a 4-post X thread 0.36 USDC
   ([tx](https://explorer.testnet.arc.io/tx/0x2ccd33fcb77ed5bb41af10bfa4e9f59b780f774a2c242bebdf39b29546da321a)).
2. **Verify a decision**: click _Verify_ next to any decision. The page re-hashes the record, checks the agent's
   signature (ERC-1271 for the Circle smart-contract wallet) and matches the `PayoutExecuted` event on Arc.
3. **Run a program** `/app`: connect a wallet, create a program, deploy and fund its vault, share the join link.
4. **Contribute** `/join/<slug>`: sign in with X, prove your wallet with a signature, submit links, and watch the
   agent decide.

Everything on Arc testnet is real and checkable on the explorer (see [On-chain](#on-chain)).

## How it works

```
contributor link ──► fetch (X / GitHub / article, SSRF-guarded) ──► deterministic checks ──► Claude judge
                                                                                   │
              signed decision record ◄── decision engine (pure rules) ◄────────────┘
                     │
round closes ──► re-check ──► plan payouts within caps ──► proposeRound ──► executeRound (or owner approves)
                                                              MisthosVault on Arc: USDC transfers + events
```

- **Fetching** reads exactly what was linked. For an X post that includes the author's own thread (their
  self-reply chain, up to 25 posts), so a "3+ post thread" rule judges the whole thread.
- **Deterministic checks** catch what code can prove: someone else's post, reposts, duplicates, copied text
  (pg_trgm + SimHash), out-of-window work, unmerged PRs, deleted content, new accounts, engagement anomalies, and
  prompt-injection attempts (including hidden text in articles).
- **The judge** (Claude Haiku 4.5) scores only the rubric, through a strict tool schema. Submission content is
  untrusted and fenced with a random per-request boundary.
- **The decision engine** is plain TypeScript. Hard flags reject; prompt injection always goes to a human, even when
  the model is fooled; low confidence, soft flags or large amounts go to review; clear spam is rejected
  automatically and can be overridden. Points come from the criterion scores in code, and work the judge would
  reject is never priced above 0.
- **Decision records** are canonical JSON (sorted keys), hashed with keccak256 and signed by the agent's Circle
  smart-contract wallet. Each payout's on-chain `decisionHash` commits to the records it pays. A reviewer override
  or a re-process is a new signed record that names the one it supersedes; nothing is rewritten.
- **The vault** enforces per-payout, per-round and rolling 24h caps, an owner approval threshold, a cooldown for new
  or changed payout wallets, pause, and owner withdrawal at any time. A `payoutId` can never be paid twice.

More: [ARCHITECTURE.md](./ARCHITECTURE.md) · [SECURITY.md](./SECURITY.md) ·
[docs/SECURITY_AUDIT.md](./docs/SECURITY_AUDIT.md) · [docs/TEST_REPORT.md](./docs/TEST_REPORT.md)

## Circle and Arc, and where they are used

| Tool                                  | Use                                                                   | Code                                                                      |
| ------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| USDC on Arc                           | All payouts, 6-decimal ERC-20 interface; gas paid in USDC             | `packages/contracts/src/MisthosVault.sol`, `packages/shared/src/money.ts` |
| Circle Developer-Controlled Wallets   | The agent is an SCA on ARC-TESTNET (executor + record signer)         | `apps/worker/src/circle.ts`, `apps/worker/scripts/circle-setup.ts`        |
| Circle Gas Station                    | Sponsors the agent SCA's gas (default testnet policy)                 | `apps/worker/src/circle.ts` (balance stays 0)                             |
| Circle Contracts API (contract exec.) | `registerPayee`, `proposeRound`, `executeRound` with idempotency keys | `packages/agent/src/rounds/job.ts`, `apps/worker/src/circle.ts`           |
| ERC-1271 signatures                   | Decision records verify against the agent SCA on Arc                  | `packages/shared/src/signatures.ts`, `apps/web/src/lib/verify.ts`         |

## On-chain

Arc testnet (chain 5042002):

| Contract                               | Address                                                                                                                          |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| MisthosVaultFactory (verified)         | [0x19afd6fCeb49A333B3b3b455A26e6ee43db8849b](https://explorer.testnet.arc.io/address/0x19afd6fCeb49A333B3b3b455A26e6ee43db8849b) |
| MisthosVault implementation (verified) | [0xbB016FeB193c9F1151e77444a2145c5dfAA965D7](https://explorer.testnet.arc.io/address/0xbB016FeB193c9F1151e77444a2145c5dfAA965D7) |
| Agent SCA (Circle)                     | [0x74a60caa5e6c14a33be4ebf1507a209ac61b78a1](https://explorer.testnet.arc.io/address/0x74a60caa5e6c14a33be4ebf1507a209ac61b78a1) |
| Live-round vault                       | [0x09138198c0056189727dfe809E67934c1B7fD973](https://explorer.testnet.arc.io/address/0x09138198c0056189727dfe809E67934c1B7fD973) |

Live rounds on that vault: an auto-executed round
([execute](https://explorer.testnet.arc.io/tx/0x1b22e940e2ce08647259129f3a047a0792ee222193408653ff1c59511e42cd42)) and
a round above the approval threshold that waited for the owner
([approve](https://explorer.testnet.arc.io/tx/0x760d0e8e1a936cc5f308d7402cf658c211cded0e75e0dca601010b2383add98e),
[execute](https://explorer.testnet.arc.io/tx/0x5b56ab5de70be70b56030d5dd3a6cbbc2a75c936c33be02c5f250b35f3ba29ce)).

## Deployment

| Part      | Where                                                              | Notes                                                                                                             |
| --------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Web app   | Vercel, [misthos-iota.vercel.app](https://misthos-iota.vercel.app) | `apps/web`, built from `main`; no signing keys; edge rate limit on `/api/auth`, `/api/public`, `/api/contributor` |
| Worker    | Railway, always on                                                 | `apps/worker/Dockerfile` + `railway.json` (restart always); the only process with the Circle entity secret        |
| Database  | Neon Postgres                                                      | migrations in `packages/db/migrations` (`pnpm --filter @misthos/db db:migrate`)                                   |
| Contracts | Arc testnet                                                        | addresses above; mainnet only with the owner's explicit approval                                                  |

## Screenshots

|                                                            |                                                                 |
| ---------------------------------------------------------- | --------------------------------------------------------------- |
| ![Owner overview](docs/screenshots/app-overview-light.png) | ![Review drawer](docs/screenshots/review-drawer-dark.png)       |
| ![Round detail](docs/screenshots/round-detail-light.png)   | ![Contributor home](docs/screenshots/contributor-home-dark.png) |

All screens, light and dark: [docs/screenshots](./docs/screenshots). They show a demo program (labeled as such
and excluded from metrics) whose decisions are signed by the real agent wallet and whose round was paid on Arc
testnet.

## Run it locally

Requires Node 22+, pnpm 12 and Foundry.

```bash
pnpm install
cp .env.example .env                     # fill in; every variable is documented
pnpm --filter @misthos/db db:migrate     # Neon / Postgres with pg_trgm
pnpm --filter @misthos/worker circle:setup   # once: entity secret + agent SCA (testnet)
pnpm --filter @misthos/worker dev        # agent worker (pg-boss); the only process holding signing keys
pnpm --filter @misthos/web dev           # app on http://localhost:3000
```

## Tests

```bash
pnpm test                                # everything: Vitest + Foundry
pnpm --filter @misthos/contracts test    # unit, fuzz (1,024 runs) and invariant tests
pnpm --filter @misthos/agent test        # every flag, every engine rule, adversarial fixtures, round job
pnpm --filter @misthos/web e2e           # browser e2e on a throwaway in-memory Postgres
ARC_RPC_TESTS=1 pnpm --filter @misthos/shared test   # live ERC-1271 checks on Arc testnet
```

Re-process decided submissions with the current agent (fresh fetch, new signed decision that supersedes the old
one): `pnpm --filter @misthos/worker reprocess <submission id | URL> --reason "why"`.

Live checks (real APIs, small cost): `pnpm --filter @misthos/agent live-check -- <urls>`,
`pnpm --filter @misthos/worker live:round`, and the demo of the contract refusing an over-cap payout,
`pnpm --filter @misthos/worker demo:cap-revert`.

## Repository

```
misthos/
├── apps/
│   ├── web/                 Next.js 16: landing, owner app (/app), contributor pages (/join, /c), public audit (/p),
│   │                        verify tool, docs (content/docs); API routes under src/app/api; no signing keys
│   └── worker/              pg-boss worker: agent pipeline, rounds, payees, overrides; Circle wallet adapters;
│                            ops scripts (circle:setup, reprocess, live:round, seed:showcase)
├── packages/
│   ├── contracts/           MisthosVault + MisthosVaultFactory (Foundry): unit, fuzz, invariant, gas and fork tests
│   ├── agent/               fetchers (X incl. threads, GitHub, SSRF-safe articles), checks, injection pre-check,
│   │                        Claude judge, decision engine, signed records, round planner and job
│   ├── db/                  Drizzle schema and SQL migrations (Postgres + pg_trgm, append-only audit log)
│   └── shared/              chain config (with citations), schemas, ids and hashing, signature verification
└── docs/                    SECURITY_AUDIT.md, TEST_REPORT.md, QA and UX reports, screenshots, examples/
```
