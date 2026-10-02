# Misthos QA report (Phase 6.5)

Full functional QA on **Arc testnet** against the **real database (Neon)** and the **real agent**: the Circle
smart-contract wallet that signs and executes, Claude Haiku 4.5 as the judge, the pg-boss queue, and real vault
contracts. Every flow was driven through the browser with real testnet wallets.

## How it was run

- **Wallets.** Five fresh testnet-only wallets (owner, owner-2 non-member, three contributors) plus one created
  mid-run for a wallet change, kept in the gitignored `.qa-wallets.json`. Keys are never printed.
- **Funding.** Circle's faucet API (`POST /v1/faucet/drips`) returned **403 Forbidden** for our API key, so the
  wallets were funded from the deployer. Contributor wallets only sign messages and need no funds.
- **Browser wallet.** `apps/web/e2e/qa/wallet.ts` is a real EIP-1193 provider announced through EIP-6963. It signs
  and sends with the QA key on Arc testnet, and can decline a request (code 4001) or switch to the wrong network on
  demand. ConnectKit lists it like the MetaMask extension, which is the path real desktop users take; a check with
  a generic EIP-6963 wallet confirmed other browser wallets are listed by name too.
- **Contributor sign-in.** "Sign in with X" needs a real X account, so the runner creates the contributor exactly as
  the X callback does (user row + the same signed session cookie). Everything after that is the real UI.
- **Submitted content.** The fictional contributors can't post on X, so the QA worker
  (`apps/worker/scripts/qa-worker.ts`) serves links in a reserved ID range from a fixtures file. Every other link is
  fetched for real (one real GitHub pull request is part of the run). Checks, Claude, the decision engine, signing,
  payouts and the database are all real.
- **Program data.** Every QA program is marked `is_demo` the moment it's created, so none of it reaches the
  metrics. All leftover vault balances were withdrawn back to the QA owner.
- **Runner.** `apps/web/e2e/qa/live-qa.mts` against a production build of the web app; results in
  `.qa/results.json`, failure screenshots in `.qa/shots/` (both gitignored).

```bash
pnpm --filter @misthos/worker exec tsx --env-file=../../.env scripts/qa-wallets.ts --fund
QA_BASE=http://localhost:3300 pnpm --filter @misthos/web exec tsx e2e/qa/live-qa.mts
pnpm --filter @misthos/web exec tsx e2e/qa/report.mts      # this table
```

## Final run

Run on 2026-10-02 against a production build of the web app, the real Neon database and Arc testnet.
Program `6147c856-320d-4479-bb9a-734289b7cc09`, vault [`0x6fe1bd2acb5ab4f315da8e354eb0101282d28e03`](https://explorer.testnet.arc.io/address/0x6fe1bd2acb5ab4f315da8e354eb0101282d28e03) (both
marked demo). Round 1 needed the owner's approval and was executed in
[`0xa3143043…`](https://explorer.testnet.arc.io/tx/0xa3143043992548388fd6af9285ca8dbb784223f3aba7b61a06fbfc09717a477d).

| #          | Area        | Test                                                                                        | Result | Evidence                                                                                                                                              | Time |
| ---------- | ----------- | ------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| O-01       | Owner       | Sign in: rejected signature, then wrong network, then success                               | Pass   | declined message shown; ConnectKit switch-network modal fixed the chain in one click; SIWE sign-in succeeded                                          | 13 s |
| O-02       | Owner       | Create a program with the wizard (inline validation, 0h cooldown warning)                   | Pass   | program 6147c856-320d-4479-bb9a-734289b7cc09 (marked is_demo); slug error shown on blur: "3–40 characters: lowercase letters, numbers and hyphens"    | 5 s  |
| O-03       | Owner       | Setup checklist shows 0 of 5 with Deploy as next step                                       | Pass   | 0 of 5 done, next: deploy the vault                                                                                                                   | 1 s  |
| O-04       | Owner       | Deploy the vault (confirm dialog → wallet → Arc → recorded)                                 | Pass   | Vault deployed. Next: fund it with USDC. View; vault 0x6fe1bd2acb5ab4f315da8e354eb0101282d28e03 owned by the QA owner                                 | 5 s  |
| E-01       | Edge        | Insufficient USDC: amount above wallet balance is blocked inline                            | Pass   | inline error shown and Fund disabled                                                                                                                  | 1 s  |
| E-02       | Edge        | Rejected transaction, then retry from the failed step                                       | Pass   | declined shown with Try again; retry → Deposited 2.00 USDC into the vault. View; vault holds 2.00 USDC                                                | 10 s |
| O-05       | Owner       | Publish and get the join link                                                               | Pass   | join page open, copy-link field shown, checklist 2 of 5                                                                                               | 5 s  |
| C-01-alice | Contributor | Join as @qa_alice6853: X session → connect wallet → sign                                    | Pass   | joined; dashboard loaded at 375px with no horizontal overflow                                                                                         | 9 s  |
| C-01-bob   | Contributor | Join as @qa_bob6853: X session → connect wallet → sign                                      | Pass   | joined; dashboard loaded                                                                                                                              | 9 s  |
| C-01-carol | Contributor | Join as @qa_carol6853: X session → connect wallet → sign                                    | Pass   | joined; dashboard loaded                                                                                                                              | 9 s  |
| C-02       | Contributor | Payout wallets registered in the vault (payee sync via Circle)                              | Pass   | 3 payees registered on-chain                                                                                                                          | 7 s  |
| C-03       | Contributor | Submit: 'what happens next' shown; double submit blocked                                    | Pass   | what-happens-next panel shown; resubmitting the same link was refused                                                                                 | 9 s  |
| C-03b      | Contributor | Bob and Carol submit their posts                                                            | Pass   | 4 submissions accepted                                                                                                                                | 28 s |
| A-01       | Agent       | Original thread is approved automatically                                                   | Pass   | approve by R10_AUTO_APPROVE, 0.366666 USDC, no flags; signed by the agent wallet                                                                      | 0 s  |
| A-02       | Agent       | Thin but valid post is not paid in full automatically (partial, reduced, or sent to review) | Pass   | partial by R10_AUTO_APPROVE, 0.3 USDC, no flags; the live model's choice is recorded                                                                  | 0 s  |
| A-03       | Agent       | Someone else's post is rejected                                                             | Pass   | reject by R1_REJECT_FLAG, 0 USDC, OWNERSHIP_MISMATCH, DUPLICATE_URL; authorship checked in code                                                       | 0 s  |
| A-04       | Agent       | Copied text is rejected as a duplicate                                                      | Pass   | reject by R1_REJECT_FLAG, 0 USDC, NEAR_DUPLICATE; near-duplicate detection                                                                            | 0 s  |
| A-05       | Agent       | Work from before the round is rejected                                                      | Pass   | reject by R1_REJECT_FLAG, 0 USDC, OUT_OF_WINDOW; round window enforced                                                                                | 0 s  |
| A-06       | Agent       | Prompt injection is escalated to a human                                                    | Pass   | escalate by R2_INJECTION, 0.183333 USDC, PROMPT_INJECTION_ATTEMPT; R2 routes to review                                                                | 10 s |
| C-04       | Contributor | Rejected submission shows the reason and how to do better; Verify link                      | Pass   | guidance block and Verify link present                                                                                                                | 4 s  |
| C-05       | Contributor | Set GitHub username after joining; real PR fetched (outside the round → rejected)           | Pass   | https://github.com/wevm/viem/pull/5173 by jxom fetched from GitHub; reject (OUT_OF_WINDOW)                                                            | 17 s |
| O-06       | Owner       | Review drawer: plain-language flags; override with confirmation (signed human decision)     | Pass   | override recorded and signed (ok); confirmation showed the agent's recommendation                                                                     | 11 s |
| O-07       | Owner       | Close round 1 (confirmation) → proposed above threshold → waits for owner                   | Pass   | round 1 proposed on Arc for 0.666666 USDC (> 0.60 threshold)                                                                                          | 16 s |
| O-08       | Owner       | Approve round 1 (confirmation with total) → agent executes                                  | Pass   | Round 1 approved. The agent is sending the payouts. View; executed 0xa3143043…                                                                        | 21 s |
| O-09       | Owner       | Update limits on-chain (cooldown 0 → 1 h)                                                   | Pass   | Vault limits updated. View; cooldown on-chain 3600 s                                                                                                  | 7 s  |
| C-06       | Contributor | Change payout wallet → cooldown shown and enforced by the vault                             | Pass   | wallet changed to 0x9BDeD2FB02cAe9fF93DBe8c96140135D2267abA1; cooldown notice shown; vault payee updated (0x9bded2fb02cae9ff93dbe8c96140135d2267aba1) | 21 s |
| C-07       | Contributor | Round 2 submissions (alice; carol from her new wallet session)                              | Pass   | 2 submissions accepted                                                                                                                                | 10 s |
| A-07       | Agent       | Round 2 work is approved (by the agent, or by the owner after review)                       | Pass   | partial by R10_AUTO_APPROVE, 0.366666 USDC                                                                                                            | 10 s |
| E-03       | Edge        | Worker killed mid-round, restarted: round 2 completes exactly once                          | Pass   | executed once (1 payout, auto under threshold); carol's escalate item deferred: per_payout_cap                                                        | 43 s |
| E-04       | Edge        | Over-cap payout is refused by the vault (PayoutTooLarge)                                    | Pass   | ✗ 1.60 USDC (1 USDC over the cap): REVERTED with PayoutTooLarge(payoutId, amount 1.60 USDC, max 0.60 USDC)                                            | 3 s  |
| O-10       | Owner       | Pause vault → banner on program pages; withdraw while paused; resume                        | Pass   | paused, banner shown, Withdrew 0.10 USDC from the vault. View, resumed                                                                                | 20 s |
| P-01       | Public      | Public audit page lists rounds and payouts                                                  | Pass   | audit page shows rounds, payouts and the demo label                                                                                                   | 3 s  |
| P-02       | Public      | Verify a paid decision: all five checks pass                                                | Pass   | 5 of 5 passed for 0x97a517dc…                                                                                                                         | 6 s  |
| P-03       | Public      | Round receipt page                                                                          | Pass   | receipt loads with round 1 payouts                                                                                                                    | 2 s  |
| O-11       | Owner       | Audit export as CSV and JSON                                                                | Pass   | CSV 53 rows (includes vault.deployed); JSON 52 events                                                                                                 | 1 s  |
| O-12       | Owner       | Metrics page excludes demo programs                                                         | Pass   | non-demo submissions unchanged (0); page says "Demo programs are excluded from every number on this page"                                             | 3 s  |
| E-05       | Edge        | Non-member owner can't see or act on the program (404)                                      | Pass   | page 404, close-round API 404, export 404                                                                                                             | 10 s |
| E-06       | Edge        | Expired session: sign-in screen and a clear message on actions                              | Pass   | toast on the action; expired cookie lands on the sign-in screen                                                                                       | 4 s  |
| Z-01       | Cleanup     | Withdraw the remaining QA vault balance                                                     | Pass   | Withdrew 0.93 USDC from the vault. View                                                                                                               | 10 s |

Run 0956853: 39 passed, 0 failed.

Notes on individual results:

- **A-02**: across runs Claude chose _partial_ (final run), _escalate_ (two runs) or a reduced approval for the same
  thin thread. The test asserts what matters: thin work is never paid in full automatically.
- **A-07**: in the final run the agent approved alice's round-2 post (partial). In earlier runs it sent the same post
  to review; the runner then approves it through the owner's review endpoint, as an owner would.
- **C-06 / cooldown**: the new wallet was registered on-chain with a 1-hour wait and the dashboard showed when payouts
  resume. In the final run Claude sent carol's round-2 post to review, so a payout blocked by the cooldown wasn't
  exercised live; the vault's `PayeeInCooldown` revert is covered by the contract tests and the round planner's
  cooldown deferral by the agent tests.
- **E-03**: the worker was SIGKILLed right after the round left "open" and restarted 4 s later; the round paid
  once (1 payout row per contributor, one `executeRound`), and the next round was open afterwards (E-06).
- **Real fetch**: C-05 fetched a real merged pull request from GitHub (https://github.com/wevm/viem/pull/5173); it was rejected as outside the round,
  which is correct for older work.

## Bugs found and fixed

| #   | Severity      | Where                        | Bug                                                                                                                                                                                                                                                                                   | Fix                                                                                                                                                                                                                                                                                   | Re-test                                              |
| --- | ------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| B1  | Major         | Agent judge                  | Claude often wrote a soft-flag note just over the 120-character limit (4 of 6 calls on one real post), and the whole judgment was discarded: an extra API call, then minutes of retry backoff, sometimes ending in a needless escalation.                                             | Over-long notes and reasons are trimmed instead of failing the judgment; the limits are stated in the tool schema; regression test added.                                                                                                                                             | A-01 to A-07 pass; agent suite 146 passed            |
| B9  | Major         | Worker, rounds               | If the worker died while running a round, the round sat in "closed" until pg-boss expired the dead worker's job lease (15 minutes), delaying the payout run. Seen live: a round recovered 16 minutes after a restart.                                                                 | On startup the worker re-enqueues every round left in `closed`, `proposed` or `approved` under a fresh job key; the round job is idempotent (reads chain and DB first, deterministic Circle idempotency keys), so the old job's later retry is a no-op. Queue integration test added. | E-03 pass; worker suite 12 passed                    |
| B11 | Major         | Worker, rounds               | Found by the restart test: if the worker died right after marking a round closed, the next round was never opened (that only happened in the same run that closed it). The owner saw no open round and no "Close round now" until a contributor's next submission created one lazily. | The round job opens the next round whenever its round is past "open"; idempotent (unique program/number). Regression test fails without the fix.                                                                                                                                      | E-06 pass (round 3 open after the restart)           |
| B10 | Major         | Web → queue                  | A single Neon connection timeout made "Close round now" fail ("Couldn't queue the round"), seen live once.                                                                                                                                                                            | The producer retries once on connection errors and allows 10 s to connect (a suspended Neon compute can take seconds to wake).                                                                                                                                                        | O-07 pass                                            |
| B2  | Major         | Contributor dashboard        | Contributors couldn't add or change their GitHub username after joining, but GitHub submissions require it, so pull requests and commits could never be submitted.                                                                                                                    | `POST /api/contributor/github` (audited) and an inline editor on the dashboard.                                                                                                                                                                                                       | C-05 pass (real PR fetched)                          |
| B3  | Major         | Owner app, authz             | A signed-in owner who isn't a member of a program got HTTP **200** with the not-found screen on its pages (no data was exposed). The app-level loading boundary started streaming before the layout's `notFound()`.                                                                   | The overview's loading state moved into a route group, so program layouts can return a real 404.                                                                                                                                                                                      | E-05 pass (page, close-round API and export all 404) |
| B4  | Major         | `demo:cap-revert`            | The over-cap demo crashed on any vault except the original live one: it always used a payee registered only there, the vault reverted with `PayeeNotRegistered`, and the script crashed formatting that revert.                                                                       | `--contributor <bytes32>` option and safe printing of any revert.                                                                                                                                                                                                                     | E-04 pass (`PayoutTooLarge` at 1.60 vs 0.60 USDC)    |
| B5  | Critical (UX) | Contributor dashboard, 375px | The page overflowed horizontally on phones; cards were cut off.                                                                                                                                                                                                                       | Mobile-first rewrite, `min-w-0`/truncation on long links.                                                                                                                                                                                                                             | C-01 pass (no overflow at 375px)                     |
| B6  | Critical (UX) | Treasury                     | No way to withdraw or pause in the UI, although the docs promise it.                                                                                                                                                                                                                  | Withdraw and pause/resume with confirmations, on-chain event checks, audit entries, paused banner.                                                                                                                                                                                    | O-10 pass                                            |
| B7  | Minor         | Round pages                  | A round closed with nothing to pay showed "Closing" forever.                                                                                                                                                                                                                          | "Closed" badge, "Closed: nothing to pay" on the round page.                                                                                                                                                                                                                           | Verified on a QA round                               |
| B8  | Minor         | Cards                        | A card's header action (e.g. "Edit" on Vault limits) wrapped under long descriptions.                                                                                                                                                                                                 | Header no longer wraps; action column fixed.                                                                                                                                                                                                                                          | Visual check                                         |

Also observed, not changed:

- **Typing before the page hydrates.** Text typed into the submit box in the first instant after load (before React
  hydrates) is dropped. Real users don't type that fast; the runner waits for the form.
- **Multiple workers.** Leftover workers from aborted runs processed jobs alongside the new one. Each submission was
  still decided exactly once (atomic claims), which is the behaviour a multi-worker deployment needs.
- **The judge's choice on thin work varies.** Across runs, Claude chose _partial_, _approve with a lower amount_ or
  _send to review_ for the same thin post. All three keep a thin post from being paid in full; the test asserts that.

## Harness problems found along the way (not product bugs)

Kept here so the runs above can be read honestly:

- A stale "declined" toast was read as the retry's result (now each action waits for earlier toasts to clear).
- Fixture posts were timestamped before the program's first round; the agent correctly rejected them as out of
  window. Round 2 texts were too similar to an earlier post; the agent correctly rejected them as near-duplicates.
- Two locator mistakes (a case-sensitive "Approve" match; a strict match on text that appears three times).
- The dev server compiled pages on first visit past the 30 s navigation timeout (switched to a production build).

## Test USDC used

|                                                       | Test USDC  |
| ----------------------------------------------------- | ---------- |
| Deployer → QA owner and owner-2 (only funding)        | 4.20       |
| Still in QA wallets after the final run (recoverable) | 4.05       |
| **Spent on owner-side gas over 10 runs**              | **≈ 0.16** |

The agent's own transactions (payee registration, proposals, executions) are gas-sponsored by Circle Gas Station.
Payouts to the QA contributors stay in QA wallets; they were sent back to the owner between runs. Leftover vault
balances were withdrawn after every run. Separately, the showcase vault used for screenshots was topped up with
1.00 test USDC from the deployer for the screenshot reseed.

## Your 5-minute check: real Sign in with X

The only flow not automated, because it needs a real X account.

1. In the X developer portal (your app → User authentication settings), make sure the callback
   `http://localhost:3000/api/auth/x/callback` is listed, the app type is **Web App**, and OAuth 2.0 is on.
2. Run the app (`pnpm --filter @misthos/web dev`) and the worker (`pnpm --filter @misthos/worker dev`).
3. Open a published program's join page, `http://localhost:3000/join/<slug>`, in a private window.
4. Click **Sign in with X**, approve on X. You should land back on the join page with step 1 ticked and
   "Signed in as @yourhandle".
5. Connect a wallet, click **Sign and join**. You should land on your dashboard with a toast "You're in".
6. Paste a link to one of your own recent posts and **Submit**. Within about a minute it should show a decision with a
   reason. A post from before the round starts is rejected as outside the round; that's expected.
7. Sign out, sign in again: it should go straight through (no second X consent screen is fine either way).
8. If anything fails, the join page shows a plain message (cancelled, expired, X unavailable). Note which one.
