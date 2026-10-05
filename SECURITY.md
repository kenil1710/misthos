# Security

Misthos moves money on behalf of other people's programs. These are the controls, and where each one lives.

## Money

- **Limits are on-chain.** `MisthosVault` enforces per-payout, per-round and rolling 24h caps, an approval threshold
  for large rounds, and a cooldown before a new or changed payout wallet can be paid. Execution re-checks every
  payout against the limits and payees as they are at that moment.
- **Non-custodial.** The program owner owns the vault, can pause it, change limits, replace the agent, and withdraw
  at any time (also while paused). The agent can only register payees and propose and execute rounds.
- **Idempotent.** `paid[payoutId]` is never reset; a `payoutId` can't be paid twice. Agent transactions carry
  deterministic Circle idempotency keys, so a retried job gets the original transaction back.
- **Rounds fit in a block.** The agent proposes at most 50 payouts per round (~6.3M gas; Arc's block limit is 30M,
  and a full 200-payout proposal wouldn't fit). The rest carry over.
- **No silent overrides.** Once an item is in a planned round, the vault pays it on execution, so the app refuses
  overrides and re-processing for it; stopping it takes cancelling the round or pausing the vault.
- **Tested.** Unit tests for every revert path, fuzzing of every cap, invariants (paid + withdrawn ≤ deposited, a
  payoutId is paid at most once, only owner/agent move funds), and a model of the vault driving the round job.

## Keys

- The agent executor and decision signer is a Circle smart-contract wallet (ERC-4337 SCA, gas sponsored by Circle
  Gas Station). There is no raw agent key in production. The entity secret lives in the worker's environment; its
  recovery file is kept outside the repository.
- The testnet EOA fallback (`AGENT_PRIVATE_KEY`) and deployer key are testnet-only and never used on mainnet.
- The web app never holds a signing key; reviewer overrides are validated by the web app and signed by the worker.
- Secrets live in the gitignored `.env` (or the hosting provider's secret store) and are never logged; scripts print
  key names, never values.

## The agent

- **Untrusted content.** Submission text is fenced in a per-request random boundary; look-alike tags are neutralized;
  the judge is told nothing inside can change its instructions; output is a strict tool schema re-validated with zod.
- **Prompt injection** is detected deterministically (normalized and de-leetified text, titles, hidden article
  text, and every post of an X thread) and always escalated to a human, even if the model was fooled.
- **The model decides nothing alone.** A pure rules engine maps flags, scores and confidence to actions; hard flags
  reject regardless of the model; only high-confidence, flag-free, small items are approved automatically. Amounts
  are computed in code (never taken from the model), bounded by the rubric maximum and the vault's caps.

## Web

- Owners sign in with SIWE (domain, URI, chain, freshness, single-use nonce; EOA or ERC-1271). Contributors sign in
  with X OAuth 2.0 PKCE (S256); the X token is revoked immediately after reading the profile and never stored.
- GitHub ownership is proven with "Connect GitHub" (OAuth, no scopes; the token is revoked right after reading the
  profile). Pull requests and commits are paid only when their author's numeric GitHub id equals the connected one;
  a typed username is never trusted, and one GitHub account can be connected to only one Misthos user.
- Wallet ownership is proven by signing a server-built message bound to the program, X account, wallet, chain and a
  single-use nonce.
- Sessions are HS256 JWTs in httpOnly, SameSite=Lax cookies. Every state-changing route checks the `Origin` header,
  validates input with zod, and checks program membership (404, not 403, for other people's programs).
- Server-side article fetching is SSRF-guarded: http(s) only, default ports, every resolved IP checked at connect
  time (private, loopback, link-local, metadata ranges blocked), redirects re-validated, 10 s and 2 MB limits.
- Public and sign-in endpoints are rate-limited per IP (per session for signed-in actions); submissions also have
  a database-enforced daily quota. The limiter is per instance; production adds edge rate limiting (see
  [docs/SECURITY_AUDIT.md](docs/SECURITY_AUDIT.md)). Audit exports neutralize spreadsheet formulas.
- `audit_events` is append-only at the database level (triggers block UPDATE, DELETE and TRUNCATE).

## Data

We read only the links contributors submit (never crawl), plus, for an X post, the author's own replies in that
post's thread (one search scoped to the conversation and the author), store the fetched content to evaluate it, and
keep X identity (id, handle, account age), the connected GitHub account (id and login) and payout wallet. Decision records published on audit
pages contain handles, wallets and hashes, not the content itself.

## Reporting

Please report vulnerabilities privately to the maintainers via a GitHub security advisory on this repository.
Don't open a public issue for security problems.
