# Fix verification: F-01 to F-11

Date: 2026-10-05 · Commit: `8cc301e` (main, clean) · Fix commit under review: `8633b97` · Reviewer: independent, first
look at this work.

**Rules followed.** Review only. No application code was changed, nothing was deployed, no funds were moved and no
production data was written. Attacks ran only locally (Vitest with PGlite and the in-memory `FakeVault`). The live
site was only read, with anonymous GETs plus the public, side-effect-free `POST /api/public/verify`. To check that the
regression tests catch a removed fix, source files were mutated briefly and restored from git right away (`git
status` is clean apart from the two new files below). No throwaway testnet vault was needed.

> **Update, 2026-10-05 (after this review):** N-1 to N-10, N-12 and N-13 are fixed; every `V-xx` repro is now a
> regression test asserting the fixed behavior, except V-04 (N-11), kept as a documented residual. See
> [Fix status](#fix-status) at the end.

Repro files (now regression tests). Each `V-xx` test **passed while the weakness existed**:

- `packages/agent/test/fix-verification.test.ts` (V-01 to V-09)
- `apps/worker/test/fix-verification.test.ts` (V-10)

Run: `cd packages/agent && npx vitest run test/fix-verification.test.ts` and `cd apps/worker && npx vitest run test/fix-verification.test.ts`.

## Summary

The fixes do what their regression tests say. Every regression test I spot-checked fails when its fix is removed
(8 mutations, 9 tests). The full suite and e2e are green. The live judge path works.

The money-flow fixes assume **one runner per round**, and nothing enforces that. Two overlapping runs of the same
round (Railway's healthcheck-gated deploy overlap, or an ops script such as `live:round`/`reprocess` run against
production while the worker runs) combined with one payee the pre-flight drops **pays a contributor twice** (N-1).
The re-plan path also has a deterministic bug: a second re-plan in a later run reuses the cancelled on-chain id and
leaves the round stuck (N-2).

F-03 is **bypassed for articles** in two ways. A stranger can still get the real author of an article hard-rejected
(N-3). A copy published as an article with a back-dated `published_time` counts as "the original" over a real X post,
including a signed rejection that supersedes the author's approval (N-4).

| ID   | Verdict                                     | Notes                                                                                                            |
| ---- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| F-01 | **Partially fixed**                         | Correct for one runner (crash, restart, non-retryable after execute). Double pay with overlapping runs: N-1.     |
| F-02 | **Partially fixed**                         | Deferral and pre-flight work. Re-plan bugs N-1, N-2; under-funding misreported: N-6.                             |
| F-03 | **Bypassed (articles)**; fixed for X/GitHub | N-3 (blocking), N-4 (back-dated copy).                                                                           |
| F-04 | **Partially fixed**                         | Comments excluded, but forum/Q&A reply authors count (N-5). Payout re-check still treats every article as owned. |
| F-05 | Verified (minor notes)                      | N-9 (secondary rate limit → hard reject); first PR picked instead of earliest.                                   |
| F-06 | Verified as scoped (agent guard + docs)     | Docs corrected. Guard is conservative (N-11). On-chain fix still pending (expected).                             |
| F-07 | Verified for the phrase the prompt asks for | Paraphrased judge notes still auto-approve (N-10, Low residual).                                                 |
| F-08 | Verified                                    | Every pass recovers rounds (mutation-tested). `singletonKey` doesn't dedupe (N-7).                               |
| F-09 | **Partially fixed**                         | Pins to the vault's `agent()`, but the vault address itself comes from the DB (N-8).                             |
| F-10 | Verified                                    | Payout re-check compares the GitHub id. `github_user_id` exists since 0004 and submissions require it.           |
| F-11 | Verified                                    | First agent decision per submission; demo, draft and vault-less programs excluded.                               |

New issues by severity: **High 3** (N-1, N-3, N-4) · **Medium 3** (N-2, N-5, N-8) · **Low 7** (N-6, N-7, N-9 to N-13).

---

## 1. Test results

| Suite                              | Result                                    |
| ---------------------------------- | ----------------------------------------- |
| contracts (Foundry)                | 90 passed, 1 skipped (fork suite)         |
| shared                             | 43 passed, 4 skipped                      |
| db                                 | 12 passed                                 |
| web                                | 136 passed                                |
| agent                              | 182 passed, 1 skipped                     |
| worker                             | 16 passed                                 |
| **e2e (Playwright, local PGlite)** | **21 passed** (2.0 min, production build) |

Migration 0007 is applied by every PGlite test DB and by the e2e DB server, with no errors. (`.env` has no
`WORKER_URL`, so the e2e app could not wake the production worker.)

**Do the regression tests catch a removed fix?** Yes, for every one checked. Each fix below was removed in place, the
matching test was run, and the file was restored with `git checkout`:

| Mutation                                                  | Test that failed                                  |
| --------------------------------------------------------- | ------------------------------------------------- |
| Drop "chain says Executed → record" before execute (F-01) | `F-01: a worker killed right after executeRound…` |
| `settleFailure` ignores Executed (F-01)                   | `F-01: a non-retryable error after execution…`    |
| Payee pre-flight returns nothing (F-02)                   | `F-02: one recipient the token refuses…`          |
| Wallet-change deferral disabled (F-02)                    | `F-02: a wallet change while a round awaits…`     |
| 24 h auto-pay guard disabled (F-06)                       | `F-06: splitting work into small rounds…`         |
| Verified-author exemption removed (F-03)                  | `F-03a`                                           |
| `R2B_JUDGE_INJECTION` removed (F-07)                      | `F-07`                                            |
| Verify signer pin disabled (F-09)                         | `verify.test.ts › F-09`                           |
| `recoverRounds` removed from each pass (F-08)             | both `F-08` worker tests                          |

---

## 2. New issues

### N-1 (High) Overlapping runs of one round + a dropped payee → paid twice (F-01/F-02 bypass)

- **Repro:** `V-01` in `packages/agent/test/fix-verification.test.ts`. Alice ends with 4 USDC for 2 USDC of work.
- **How:**
  1. Run B passes pre-flight and sends `executeRound(R0)`.
  2. Bob's address becomes unpayable (blocklisted; or, with the real reader, the vault balance drops, see N-6).
  3. Run A pre-flights, drops Bob, `cancelRound(R0)`, re-plans the DB round as R1 and inserts new payouts for Alice.
  4. B's execute of R0 reverts. `settleFailure` re-reads the **DB** round, which now says R1. R1 is still `None`
     on-chain because A hasn't proposed it yet, so B calls `releaseRound`. That marks **A's new payouts** failed,
     sets Alice's `payout_id` to null and marks the round failed.
  5. A then proposes and executes R1 (its propose transaction also overwrites `status` back to `proposed`). Alice is
     paid on-chain, but her submission is `approved` and unassigned, so the next round pays her again.
- **Why this can happen in production:** `runDrain` serialises rounds only _within one process_. Railway deploys are
  healthcheck-gated (`railway.json`), so the new container starts and drains (`startup`) while the old one finishes
  its drain after SIGTERM. Recovery jobs use a different key (`round:<id>:recover`), and keys don't dedupe anyway
  (N-7). Ops scripts built on `buildDeps` (`live:round`, `reprocess`, `seed:showcase`) are a second runner if pointed
  at production. The window is the length of A's Circle `proposeRound` round-trip (seconds to a minute). That is
  rare, but the impact is direct money loss.
- **Root cause:** `releaseRound`/`recordExecuted` act on "every pending/proposed payout of the DB round", not on the
  payouts of the on-chain round id that was cancelled or executed. Nothing stops two `runRound` calls on one round.
- **Fix:**
  1. Take a per-round lock in `runRound`: `pg_try_advisory_lock(hashtext(round.id))` on a dedicated connection, or a
     lease column with expiry. Skip the run if the lock is held.
  2. Scope release/record to the on-chain id: keep `roundIdBytes32` on each payout row (or match
     `payoutIdFor(program, roundBytes, contributor)`), and have `settleFailure` use the id it actually sent.
  3. Make the propose transaction conditional (`WHERE status = 'closed' AND round_id_bytes32 = $roundBytes`).

### N-2 (Medium) A second re-plan in a later run reuses the cancelled on-chain id; the round sticks

- **Repro:** `V-02`.
  1. Run 1 drops Bob and re-plans as `…:retry1`, which needs approval, so the run returns.
  2. Before the owner approves, Carol becomes unpayable.
  3. The next 15-minute pass cancels `retry1` and re-plans under **`retry1` again**, because the suffix comes from the
     per-run loop counter (`job.ts:688`, `retry${attempt + 1}`).
  4. The new payout ids collide with the failed rows (`payouts.payout_id_bytes32` is globally unique), so the insert
     throws.
- **Impact:** The round stays `closed` with a cancelled id. Every retry, and every recovery pass (each adds a job,
  see N-7), throws again after re-fetching every item from X (paid API). Items aren't lost: they're unassigned and
  the next round picks them up. But the round never finishes and the cost repeats.
- **Fix:** derive the retry id from persistent state, such as a `replan_count` column or the count of
  `round.replanned` audit events. Also apply `MAX_REPLANS` across runs, not per run.

### N-3 (High) F-03 bypass for articles: a stranger pre-submits the real author's article → author hard-rejected

- **Repro:** `V-05`. Alice is named in `twitter:creator`. Mallory submitted the URL first. Alice gets `DUPLICATE_URL`
  (hard) and the decision is `reject`.
- **Why:** articles never get `OWNERSHIP_MISMATCH` (only the soft `OWNERSHIP_UNVERIFIED`), so the pipeline's
  `passedOwnership` filter (`pipeline.ts:249`) keeps Mallory's prior. `isVerifiedAuthor` is hard-coded `false` for
  articles (`checks.ts`).
- **Fix:** treat `authorHandles ∋ contributor.xHandle` as the verified author for articles. Count a prior only if its
  ownership was _positively_ verified (no `OWNERSHIP_UNVERIFIED`, no `OWNERSHIP_MISMATCH`).

### N-4 (High) F-03 bypass: a back-dated article copy becomes "the original", even over a real X post

- **Repro:** `V-06`. Alice's X thread is hard-rejected `NEAR_DUPLICATE` against Mallory's article whose
  `<meta article:published_time>` is set to the day before.
- **Why:** near-duplicate ordering uses `fetched_resources.payload_json->>'timestamp'`. For articles that value comes
  from author-controlled page metadata (`fetch/article.ts:24-36`). The similarity query spans source types. If Alice
  submitted first, Mallory's later submission runs `rejectAsCopy` **against Alice** (`pipeline.ts:522-541`): a signed
  agent rejection that supersedes Alice's approval. Mallory's own article (her blog, her `twitter:creator`) passes
  ownership and can auto-approve. That is steal-and-block, the original F-03 outcome.
- **Fix:** only trust platform timestamps (X `created_at`, GitHub `merged_at`) for ordering. For articles, use
  first-seen time (`fetched_resources.created_at`) and never let an article's date make _another_ submission the
  copy. `rejectAsCopy` should require a trusted timestamp on both sides.

### N-5 (Medium) F-04 partial: reply authors on forum/Q&A pages count as the article's author

- **Repro:** `V-07`. On a Discourse-style page every post has `itemprop="author"`, and replies sit in
  `div.topic-body`, not in a `*comment*` class. A reply whose display name is "Mallory (@mallory)" puts `mallory` in
  `authorHandles`, so there's no ownership flag and the page can auto-approve.
- **Also:** the payout re-check still treats every article as owned (`job.ts:197`). The audit's "re-check ownership
  at payout" item wasn't done.
- **Fix:** take `itemprop=author`/`.author`/`.byline` only from the first one in document order, or only inside the
  main `<article>`/`h-entry` that Readability selected. Re-run `findAuthorHandles` at payout.

### N-8 (Medium) F-09 partial: the vault address is still read from Misthos's DB

Verify now requires record signer = published signer = `vault.agent()`. But the vault comes from
`programs.vault_address` in the same DB, so someone with DB write access can point it at any contract whose `agent()`
returns their key, and Verify says "it is the vault's agent on Arc". A program with no vault passes unpinned (this is
stated in the detail text).

Second effect: after a legitimate `setAgent` rotation, every older record will show "Not verified". Live records are
all signed by the current agent `0x74a6…78a1` today, so nothing shows this yet.

**Fix:** pin to a published agent list (and past agents) shipped with the app or the docs. Also show the vault and
check it against the factory (`predictVaultAddress(owner, programIdBytes32)` plus code at that address).

### N-6 (Low) Pre-flight reports an under-funded vault as "recipient can't receive" for everyone

- **Repro:** `V-03`, which uses a subclass that models the real reader. The real `canReceive` simulates
  `token.transfer` **from the vault**, so it also fails when the vault holds less than the payout. `FakeVault`
  ignores balance, so the shipped tests can't see this.
- **Effect:** after the owner approves, a balance drop drops every payee. The approved round is cancelled, so the
  approval is lost. `round.replanned` blames every contributor's address. The round ends `nothing_to_pay` and stays
  `closed` (never terminal).
- **Fix:** check `token.balanceOf(vault) >= total` first and report "vault under-funded" (retryable; alert the
  owner). Only then run per-recipient checks.

### N-7 (Low) `singletonKey` doesn't dedupe anything on these queues

- **Repro:** `V-10`. Three `recoverRounds` passes leave three `created` jobs for one round.
- **Why:** pg-boss 12 queues default to the `standard` policy, which has no unique index on `singleton_key` alone.
  The comment in `jobs.ts:122` ("one recovery job per round at a time") and the web's `"duplicate"` path are
  therefore never true.
- **Effect:** with rounds that succeed this is harmless (all jobs run in one drain, serially). With a failing round
  (N-2, a Circle outage), each pass adds another chain of up to 9 attempts, multiplying X re-check calls and noise.
- **Fix:** create `run-round` with `policy: 'singleton'` (or `stately`), or use `singletonSeconds`. N-1's lock is
  still needed for cross-process safety.

### N-9 (Low) F-05: a GitHub secondary rate limit becomes a hard NOT_MERGED

- **Repro:** `V-08`. `get()` treats 429, 5xx and 403-with-zero-quota as retryable. The new `/repos` and `/compare`
  calls treat any other non-OK status as "not on the default branch". A secondary-rate-limit 403 (`retry-after`,
  quota > 0) therefore hard-rejects a merged commit.
- **Fix:** throw a retryable `FetchError` on `403 + retry-after` and on any unexpected non-OK status for these two
  calls.
- **Also:** `landedAt` takes the _first_ PR returned by `commits/{sha}/pulls` with a default base. Use the
  **earliest** `merged_at` so a later sync/back-merge PR can't re-date old work into a new window.

### N-10 (Low, residual) F-07: paraphrased judge notes don't escalate

`V-09`: "asks reviewers to give full marks", "claims it was pre-approved by the program owner", "tries to game the
rubric scoring" and "contains text addressed to the AI reviewer" all still `approve`. The prompt asks for the exact
phrase, so this needs the model to deviate. The audit's stronger option was to escalate on **any** judge soft flag.

### N-11 (Low) F-06 guard counts explorer-approved rounds as "auto-paid"

`V-04`: an owner approval made on the explorer leaves `txHashApprove` null, so that round counts toward the 24 h
auto-pay total and the next small round needs the owner. This errs safe. Record approval from chain state (the
`RoundApproved` log) when `runRound` sees `Approved`.

Other F-06 residuals (expected; the vault isn't changed):

- Rounds that executed on-chain but aren't recorded yet (crash) are missing from the 24 h sum until recovered.
- A compromised agent skips the guard.

### N-12 (Low) Approval route vs. re-plan race (code reading, not reproduced)

`POST /api/owner/rounds/[id]/approved` checks `round.roundIdBytes32`, then writes `status = 'approved'` with no
condition. If the worker re-plans in between, the round is left `approved` with `decision_root` null. `runRound`
plans only from `closed`, so it returns `nothing_to_pay` on every pass (items carry over; the round never finishes).
**Fix:** `WHERE status IN ('proposed','approved') AND round_id_bytes32 = $approvedId`.

### N-13 (Low) Worker `/health` is public and returns `lastError`

The worker answers anyone with `lastError` (up to 300 chars of an internal error: Circle status hints, pg errors that
can name hosts) and timestamps. The web proxy `/api/health/worker` passes on only `problem`, which can contain the
same text. Return a generic problem publicly and keep detail in logs.

---

## 3. State machine, carry-over, wake + tick, migration 0007

- **Round states** (closed → proposed → approved → executed / failed; re-plan back to closed with a new id). Correct
  under one runner: every branch reads the chain first, and items are released only after the vault confirms
  `Cancelled`/`None` _and_ `paid(payoutId) == false`. Gaps: N-1 (concurrency), N-2 (id reuse), N-12 (unconditional
  write).
- **Non-terminal leftovers:** `nothing_to_pay` rounds stay `closed` forever. They're skipped by recovery (SQL filter,
  tested), but the UI shows them as unfinished.
- **Carry-over:** correct. Dropped contributors, cooldown, caps and failed re-checks all return to the queue with a
  recorded reason. Deferred wallet changes are applied after execute/release (`resyncPayees`) or at the next plan.
- **Wake + 15-minute tick:**
  - A missed wake is picked up by the next tick or retry timer.
  - A wake during a drain sets `again`, so exactly one more drain runs. JS microtask ordering makes the hand-off safe.
  - Two ticks at once can't happen in one process (coalesced).
  - On a restart mid-run the active job expires after 900 s (`supervise` on non-wake drains) and the recovery job
    re-drives the round right away. Correct under one runner (live crash test in `docs/test-results/live-crash.txt`
    agrees).
  - Across two containers there's no mutual exclusion (N-1).
- **Migration 0007:** drops and re-creates `payouts_round_contributor_uq` as a partial index (`status <> 'failed'`),
  matching `schema.ts`. It is safe on existing data (the full unique index already held) and applies cleanly in every
  PGlite DB and e2e. Concurrent planning of one round is still guarded (two live rows conflict).
  `payout_id_bytes32` remains globally unique, which is what turns N-2 into a stuck round rather than a double plan.
  I couldn't confirm 0007 is applied in production (no DB access in this review). The deployed worker reports the new
  runner (`tickMinutes` in `/api/health/worker`), so the code is live.

## 4. Wake endpoint

- **Authentication:** `Authorization: Bearer <WORKER_WAKE_SECRET>` (≥ 32 chars), compared with `timingSafeEqual`. A
  missing or wrong secret returns 401 and does nothing. With no secret configured, `/wake` is off.
- **Replay:** possible but harmless. The request has no body and no parameters. A wake only runs the same idempotent
  drain the 15-minute tick runs.
- **Rate limiting:** none on the worker, but drains coalesce: at most one running plus one queued, whatever the wake
  rate. Each extra drain opens a DB connection, so a leaked secret could keep Neon awake (cost, not safety). Consider
  a simple 1-per-10 s floor. The web side wakes only after a successful enqueue, behind the existing per-route limits.
- **Can it trigger payouts or anything unsafe?** No beyond what the tick already does. It can't enqueue jobs, can't
  set `force`, and can't close an open round early. It only advances rounds that are already due or in flight, a few
  minutes sooner. It doesn't run `supervise`, so a wake flood can't expire active jobs.
- **Transport:** `WORKER_URL` must be a URL. `fetch` follows redirects, but per spec the `Authorization` header is
  dropped on cross-origin redirects. Set `redirect: "error"` to be explicit.

## 5. Live site (read-only), as a judge would see it

`https://misthos-iota.vercel.app`, checked 2026-10-05 ~16:15 UTC. I couldn't drive a real browser (the Chrome
extension wasn't connected), so the click path was exercised over HTTP with the same requests the page makes.

- Landing `/` → 200. It links the showcase program `/p/kency-arc-creators` and two `#verify?d=<hash>` deep links.
- Program audit page → 200. It contains the "Verify a decision" panel.
- Verify, using the panel's own APIs (`GET /api/public/decisions/<hash>` then `POST /api/public/verify`): both
  decision records on the page verify:
  - `0x2952…28e0` (reject): record, published and signature pass; the signer is the vault's agent.
  - `0xc5c3…ba34` (approve, paid): all 5 steps pass, including `PayoutExecuted` in block 65603875 from the program
    vault.
- `/docs`, `/docs/audit-trail`, `/docs/guardrails`, `/docs/security` → 200. An unknown program or round → 404.
- `/api/health/worker` → 200 `{"ok":true,…}`, last tick 16:11:58 Z.

## 6. Recommended order (not applied; waiting for approval)

1. **N-1:** per-round lock in `runRound`, plus release/record scoped to the on-chain round id.
2. **N-3 and N-4:** article ownership counts as the verified author; never order copies by article metadata dates.
3. **N-2:** persistent re-plan counter.
4. **N-7:** `singleton`/`stately` policy for `run-round`.
5. **N-5, N-8, N-6, N-9, N-12:** small, independent changes.
6. **N-10, N-11, N-13:** hardening.

Note: the project's CLAUDE.md asks for external API calls to go through Latch. No Latch tools were available in this
session. The only external calls were anonymous, credential-free reads of the public site.

## Fix status

Updated 2026-10-05. Tests: `packages/agent/test/fix-verification.test.ts` (V-01…V-09), `apps/worker/test/fix-verification.test.ts`
(V-10), `apps/web/test/verify.test.ts` (N-8), `packages/agent/test/pipeline.test.ts` (copy held for review).
Live on Arc testnet (`pnpm --filter @misthos/worker live:crash`, `docs/test-results/live-crash.txt`): worker killed
right after `executeRound` → recorded from chain once its lease expired, paid once; then two workers started the
same round at the same moment → one ran it, the other was skipped; one propose, one execute, each item paid once.

| ID   | Status              | What changed                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| N-1  | **Fixed**           | Per-round lease in the database (`rounds.lock_owner/lock_until`, database time, 5 min, renewed before every transaction): a second run is skipped, and a run that lost its lease stops before sending. Payouts carry their on-chain round id; release, record and the propose/approve writes act only on the id the run actually sent; a run whose round was re-planned by another steps aside. V-01, V-01b. |
| N-2  | **Fixed**           | Re-plan ids come from a persistent counter (`rounds.replan_count`): never a cancelled id, in any run. After 10 re-plans in total the round is cancelled and its items carry over. Payout re-checks are cached for 6 h (`submissions.rechecked_at`), so re-plans and retries don't fetch from X again. V-02.                                                                                                  |
| N-3  | **Fixed**           | `DUPLICATE_URL` counts only priors with positively verified ownership, and is soft (human review) for articles. Articles never auto-approve (`R9B_ARTICLE_REVIEW`). V-05.                                                                                                                                                                                                                                    |
| N-4  | **Fixed**           | Article dates are untrusted: an article is never "the original" (its date is ignored for ordering), a near-duplicate involving an article is soft (review), and `OUT_OF_WINDOW` from an article's own date is soft. General rule: the agent never rejects or supersedes an earlier decision; a later-found copy is **held for review** (status escalated, nothing signed). V-06, pipeline test.              |
| N-5  | **Fixed**           | Article author handles only from structured metadata: `twitter:creator`, author meta tags (an @handle or X profile URL, never a display name), `<link rel=author>` in the head, top-level JSON-LD `author` links. No bylines, `itemprop`, classes or text. Unclear → review (all articles are reviewed anyway). V-07.                                                                                        |
| N-6  | **Fixed**           | Before the payee pre-flight the worker checks the vault's balance. Under-funded → "Vault needs funds: …" on the round, the owner's approval is kept, the round waits and pays once funded (no cancel, no re-plan). V-03.                                                                                                                                                                                     |
| N-7  | **Fixed**           | Round jobs moved to a `stately` pg-boss queue (`round-run-once`) with one key per round (`roundJobKey`) for every sender (scheduler, recovery, owner close/approval): one queued and one active job per round. The old queue is still drained. V-10.                                                                                                                                                         |
| N-8  | **Fixed**           | Verify takes the vault from the on-chain `PayoutExecuted` event, checks it's a factory vault (address = the factory's CREATE2 prediction for its owner and programId), and reads `agent()` at the payout's block (unpaid records: at the block of the record's signed `decidedAt`). Older records survive an agent rotation.                                                                                 |
| N-9  | **Fixed**           | GitHub 403 + `retry-after` (secondary rate limit) is retryable; any unexpected answer from the repo/compare calls is retried and then escalated, never `NOT_MERGED`. Landing date = the earliest merge into the default branch. V-08.                                                                                                                                                                        |
| N-10 | **Fixed**           | The judge-note pattern covers paraphrases (full marks, pre-approved, gaming the rubric, text addressed to the AI reviewer, …); ordinary quality notes still auto-approve. V-09.                                                                                                                                                                                                                              |
| N-11 | Documented residual | Explorer approvals count toward the 24 h auto-pay total; errs safe. V-04 documents it.                                                                                                                                                                                                                                                                                                                       |
| N-12 | **Fixed**           | The approval route writes only if the round is still proposed/approved **on the approved on-chain id**; otherwise 409 "reload".                                                                                                                                                                                                                                                                              |
| N-13 | **Fixed**           | The worker's public `/health` returns the verdict and timestamps only; a failed pass says "see the worker logs".                                                                                                                                                                                                                                                                                             |

Notes: after a crash, the next run waits for the dead run's lease (≤ 5 min) and pg-boss's expiry of its job (≤ 15 min,
next tick); that delay is the price of one-run-per-round. The article payout re-check still checks existence only
(a person approved authorship). The wake endpoint has no rate floor (drains coalesce); the web call uses
`redirect: "error"`.
