# Misthos test report (2026-10-03)

Everything that can be tested without a person at the keyboard, run against the code in this commit. Each section
names the command that reproduces it. Raw outputs live in `docs/test-results/` and `docs/perf/`.

## Summary

| Area                                                                      | Result                                                                                                           |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Unit + integration (Vitest, 5 packages)                                   | **306 passed**, 5 skipped (env-gated), 0 failed                                                                  |
| Contracts (Foundry, incl. 1,024-run fuzz and 256×64 invariants)           | **76 passed**; Arc fork suite **2 passed** against Arc testnet                                                   |
| Browser e2e (Playwright, production build, local DB)                      | **14 / 14 passed**                                                                                               |
| Live QA (real Neon with `is_demo` programs, real Arc testnet, real agent) | **39 / 39 passed**                                                                                               |
| Link crawl (owner, contributor, public, docs)                             | **96 internal URLs, 0 broken** (also crawled against real Neon data: 58 signed-in + 21 anonymous URLs, 0 broken) |
| Accessibility (axe, WCAG 2.2 AA, 19 pages × light/dark)                   | **0 serious or critical** issues                                                                                 |
| Responsive + themes (18 pages × 375/768/1280/1440 × light/dark)           | **0 pages with horizontal overflow**; 144 screenshots                                                            |
| Lighthouse (5 pages × mobile/desktop)                                     | Performance **91–95 mobile, 100 desktop**; accessibility and best practices **100**                              |
| Load (autocannon, 20 connections)                                         | **0 errors**; p95 between 55 and 84 ms on dynamic pages                                                          |
| DB hot paths (EXPLAIN at realistic volume)                                | **11 / 11** use indexes                                                                                          |
| CI on a clean clone                                                       | see [CI](#9-ci-on-a-clean-clone)                                                                                 |

## 1. End to end

### 1a. Browser e2e (local, production build)

`pnpm --filter @misthos/web e2e` builds the app, starts it on :3100 against a throwaway in-memory Postgres with every
migration, and drives it with an injected EIP-1193 test wallet (two accounts, switchable network, rejectable
requests, and a log of every signature request).

| Spec           | Test                                                                                                                                                                                                                                                                                                                     | Result |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| home           | Owner with several programs: cards, "Needs you", programs they joined, landing header shows who's signed in                                                                                                                                                                                                              | Pass   |
| home           | Contributor home: joined programs with round, waiting, earned; tailored next steps (no "gitHub"); disclosure toggles                                                                                                                                                                                                     | Pass   |
| home           | Drafts: the owner sees a preview of join and audit pages, everyone else a 404 with useful links                                                                                                                                                                                                                          | Pass   |
| home           | A published program with no payouts has a working audit page ("Nothing to audit yet")                                                                                                                                                                                                                                    | Pass   |
| home           | Non-members get a 404 for someone else's program; an expired contributor session is explained and the link is kept                                                                                                                                                                                                       | Pass   |
| home           | Submitting is instant (optimistic); a double click creates exactly one submission; invalid links are caught before sending                                                                                                                                                                                               | Pass   |
| home           | Focus rings: none after mouse clicks on the logo, nav or switcher; keyboard Tab still shows one                                                                                                                                                                                                                          | Pass   |
| owner-and-join | Owner signs in (SIWE), wizard with inline validation, publishes; contributor joins with a signed wallet proof, switches wallet; owner sees it under "Needs you"; DB, audit log and nonces checked                                                                                                                        | Pass   |
| owner-ux       | Wizard keeps its draft through Back, browser back and reload; Round 1 starts now; single program → `/app` opens it; reload reconnects the wallet; scheduled round can't be closed and can be started (audited); audit labels                                                                                             | Pass   |
| wallet         | Owner switches account → notice, no signature; switches back → gone; wrong network → one-click switch; reload reconnects silently; disconnect → one Connect button                                                                                                                                                       | Pass   |
| wallet         | Declined connection and declined signature explain themselves and can be retried                                                                                                                                                                                                                                         | Pass   |
| wallet         | WalletConnect "Proposal expired" (unhandled rejection) → "Connection request expired. Try again." with a retry; no page error, no console error                                                                                                                                                                          | Pass   |
| wallet         | Contributor's extension on another account → a quiet line in the Account card (no banner); "Use this wallet instead" opens the change flow; "Change payout wallet" while still on the payout account → compact "Pick the new wallet" dialog that closes when the account switches; no signature until the explicit click | Pass   |
| wallet         | Depositing more USDC than the wallet holds (read from Arc testnet) is refused inline before any prompt                                                                                                                                                                                                                   | Pass   |

### 1b. Live QA on Arc testnet and Neon

`QA_BASE=http://localhost:3300 pnpm --filter @misthos/web exec tsx e2e/qa/live-qa.mts` against a production build on
real Neon, with real testnet wallets (keys in the gitignored `.qa-wallets.json`), the real worker, Circle agent
wallet, Claude (`claude-haiku-4-5-20251001`) and GitHub. Every program it creates is marked `is_demo`.
X sign-in and GitHub OAuth are simulated by writing exactly what their callbacks store (a real account is needed for
the real thing). Run `0996031` (final code): vault `0x98e03278c785ddb770abea7ac199e1c850a92696`, round 1 executed in
`0x0389a3fc566dad0ee87b0e1f5e091408d36e180b52de01d83f654e6e985d29af`. Spent about 0.96 test USDC (2.50 → 1.54
for the QA owner; the rest went to QA contributors as payouts). Five full runs were made in total while fixing what
they found (see section 10); this is the last one.

| ID         | Area        | Check                                                                                                              | Result | Evidence                                                                                                                                                                 |
| ---------- | ----------- | ------------------------------------------------------------------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| O-01       | Owner       | Sign in: rejected signature, then wrong network, then success                                                      | Pass   | declined message shown; one-click 'Switch to Arc Testnet' fixed the chain; SIWE sign-in succeeded; no signature was ever requested without a click                       |
| O-02       | Owner       | Create a program with the wizard (inline validation, 0h cooldown warning)                                          | Pass   | program 49125c6e-fa7d-44a4-8414-88108fa0184d (marked is_demo); slug error shown on blur: "3–40 characters: lowercase letters, numbers and hyphens"                       |
| O-03       | Owner       | Setup checklist shows 0 of 3 with Deploy as next step                                                              | Pass   | 0 of 3 done, next: deploy the vault                                                                                                                                      |
| O-04       | Owner       | Deploy the vault (confirm dialog → wallet → Arc → recorded)                                                        | Pass   | Vault deployed. Next: fund it with USDC. View; vault 0x98e03278c785ddb770abea7ac199e1c850a92696 owned by the QA owner                                                    |
| E-01       | Edge        | Insufficient USDC: amount above wallet balance is blocked inline                                                   | Pass   | inline error shown and Fund disabled                                                                                                                                     |
| E-02       | Edge        | Rejected transaction, then retry from the failed step                                                              | Pass   | declined shown with Try again; retry → Deposited 2.00 USDC into the vault. View; vault holds 2.00 USDC                                                                   |
| O-05       | Owner       | Publish and get the join link                                                                                      | Pass   | join page open; status: "Round 1 is open · ends in 7 days · 0 submissions · 0.00 USDC ready to pay Copy join link Share on X"; first-submissions panel shown             |
| C-01-alice | Contributor | Join as @qa_alice6031: X session → connect wallet → sign                                                           | Pass   | joined; dashboard loaded at 375px with no horizontal overflow                                                                                                            |
| C-01-bob   | Contributor | Join as @qa_bob6031: X session → connect wallet → sign                                                             | Pass   | joined; dashboard loaded                                                                                                                                                 |
| C-01-carol | Contributor | Join as @qa_carol6031: X session → connect wallet → sign                                                           | Pass   | joined; dashboard loaded                                                                                                                                                 |
| C-02       | Contributor | Payout wallets registered in the vault (payee sync via Circle)                                                     | Pass   | 3 payees registered on-chain                                                                                                                                             |
| C-03       | Contributor | Submit: 'what happens next' shown; double submit blocked                                                           | Pass   | what-happens-next panel shown; resubmitting the same link was refused                                                                                                    |
| C-03b      | Contributor | Bob and Carol submit their posts                                                                                   | Pass   | 4 submissions accepted                                                                                                                                                   |
| A-01       | Agent       | Original thread is approved automatically                                                                          | Pass   | approve by R10_AUTO_APPROVE, 0.35 USDC, no flags; signed by the agent wallet                                                                                             |
| A-02       | Agent       | Thin but valid post is not paid in full automatically (partial, reduced, or sent to review)                        | Pass   | partial by R10_AUTO_APPROVE, 0.283333 USDC, no flags; the live model's choice is recorded                                                                                |
| A-03       | Agent       | Someone else's post is rejected                                                                                    | Pass   | reject by R1_REJECT_FLAG, 0 USDC, OWNERSHIP_MISMATCH, DUPLICATE_URL; authorship checked in code                                                                          |
| A-04       | Agent       | Copied text is rejected as a duplicate                                                                             | Pass   | reject by R1_REJECT_FLAG, 0 USDC, NEAR_DUPLICATE; near-duplicate detection                                                                                               |
| A-05       | Agent       | Work from before the round is rejected                                                                             | Pass   | reject by R1_REJECT_FLAG, 0 USDC, OUT_OF_WINDOW; round window enforced                                                                                                   |
| A-06       | Agent       | Prompt injection is escalated to a human                                                                           | Pass   | escalate by R2_INJECTION, 0.166666 USDC, PROMPT_INJECTION_ATTEMPT; R2 routes to review                                                                                   |
| C-04       | Contributor | Rejected submission shows the reason and how to do better; Verify link                                             | Pass   | guidance block and Verify link present                                                                                                                                   |
| C-05       | Contributor | Connect GitHub (simulated OAuth callback); own merged PR fetched for real; someone else's PR is refused (spoofing) | Pass   | https://github.com/wevm/viem/pull/5173 by jxom (id 7336481): own submission reject (OUT_OF_WINDOW); alice's copy rejected (OWNERSHIP_MISMATCH, OUT_OF_WINDOW, DUPLICATE… |
| O-06       | Owner       | Review drawer: plain-language flags; override with confirmation (signed human decision)                            | Pass   | override recorded and signed (ok); confirmation showed the agent's recommendation                                                                                        |
| O-07       | Owner       | Close round 1 (confirmation) → proposed above threshold → waits for owner                                          | Pass   | round 1 proposed on Arc for 0.65 USDC (> 0.60 threshold)                                                                                                                 |
| O-08       | Owner       | Approve round 1 (confirmation with total) → agent executes                                                         | Pass   | Round 1 approved. The agent is sending the payouts. View; executed 0x0389a3fc566dad0ee87b0e1f5e091408d36e180b52de01d83f654e6e985d29af                                    |
| O-09       | Owner       | Update limits on-chain (cooldown 0 → 1 h)                                                                          | Pass   | Vault limits updated. View; cooldown on-chain 3600 s                                                                                                                     |
| C-06       | Contributor | Change payout wallet → cooldown shown and enforced by the vault                                                    | Pass   | wallet changed to 0xe777484690Ef89482C4E5CE5fB734a9b221d7416; cooldown notice shown; vault payee updated (0xe777484690ef89482c4e5ce5fb734a9b221d7416)                    |
| C-07       | Contributor | Round 2 submissions (alice; carol from her new wallet session)                                                     | Pass   | 2 submissions accepted                                                                                                                                                   |
| A-07       | Agent       | Round 2 work is approved (by the agent, or by the owner after review)                                              | Pass   | approve by R10_AUTO_APPROVE, 0.366666 USDC                                                                                                                               |
| E-03       | Edge        | Worker killed mid-round, restarted: round 2 completes exactly once                                                 | Pass   | executed once (1 payout, auto under threshold); carol's escalate item deferred: per_payout_cap                                                                           |
| E-04       | Edge        | Over-cap payout is refused by the vault (PayoutTooLarge)                                                           | Pass   | ✗ 1.60 USDC (1 USDC over the cap): REVERTED with PayoutTooLarge(payoutId, amount 1.60 USDC, max 0.60 USDC)                                                               |
| O-10       | Owner       | Pause vault → banner on program pages; withdraw while paused; resume                                               | Pass   | paused, banner shown, Withdrew 0.10 USDC from the vault. View, resumed                                                                                                   |
| P-01       | Public      | Public audit page lists rounds and payouts                                                                         | Pass   | audit page shows rounds, payouts and the demo label                                                                                                                      |
| P-02       | Public      | Verify a paid decision: all five checks pass                                                                       | Pass   | 5 of 5 passed for 0x9019708d…                                                                                                                                            |
| P-03       | Public      | Round receipt page                                                                                                 | Pass   | receipt loads with round 1 payouts                                                                                                                                       |
| O-11       | Owner       | Audit export as CSV and JSON                                                                                       | Pass   | CSV 54 rows (includes vault.deployed); JSON 53 events                                                                                                                    |
| O-12       | Owner       | Metrics page excludes demo programs                                                                                | Pass   | non-demo submissions unchanged (0); page says "Demo programs are excluded from every number on this page"                                                                |
| E-05       | Edge        | Non-member owner can't see or act on the program (404)                                                             | Pass   | page 404, close-round API 404, export 404                                                                                                                                |
| E-06       | Edge        | Expired session: sign-in screen and a clear message on actions                                                     | Pass   | toast on the action; expired cookie lands on the sign-in screen                                                                                                          |
| Z-01       | Cleanup     | Withdraw the remaining QA vault balance                                                                            | Pass   | Withdrew 0.96 USDC from the vault. View                                                                                                                                  |

Coverage of the requested scenarios:

- **Owner:** sign-in (O-01), wizard incl. Back/reload draft (O-02; e2e owner-ux), start-now and scheduled rounds
  (e2e owner-ux; `test/schedule.test.ts`), deploy (O-04), fund (E-02), edit limits (O-09), edit schedule / start round
  now (e2e owner-ux), Share on X link (e2e home; O-05 status bar), publish (O-05), pause/resume and withdraw (O-10).
- **Contributor:** join page and simulated X sign-in (C-01), Connect GitHub via simulated OAuth callback (C-05), wallet
  link (C-01) and change + cooldown (C-06), every source type (X posts in A-series, GitHub PR in C-05, articles and
  commits in the agent pipeline tests), decision + reasoning and Verify link (C-04), earnings and countdown (e2e home),
  payout history (P-03 receipt; contributor page).
- **Agent outcomes:** approve (A-01), partial (A-02), reject (A-03…A-05), escalate (A-06), injection (A-06),
  duplicate (A-03 `DUPLICATE_URL`), near-duplicate (A-04), someone else's X post (A-03), someone else's GitHub PR /
  spoofing (C-05), out-of-window (A-05), auto-reject clear spam (unit: `engine.test.ts` R5a), human override (O-06).
- **Rounds:** close (O-07), owner approval above threshold (O-07/O-08), auto-execute under threshold (E-03), over-cap
  revert on-chain (E-04, `PayoutTooLarge`), carry-over of what doesn't fit (`plan.test.ts`; E-03 reports deferrals),
  worker killed mid-round → completes exactly once (E-03).
- **Public:** audit page with payouts (P-01) and without (e2e home), Verify a decision: all five checks (P-02), round
  receipt (P-03).
- **Signed-in home:** owner and contributor views, single-program redirect (e2e home, owner-ux).

## 2. Wallet scenarios (injected test provider)

| Scenario                                                                                                                 | Where                                    | Result |
| ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- | ------ |
| Switch account → quiet hint (owner chip dot / contributor note), **no automatic signature** (signature requests counted) | e2e wallet (owner and contributor)       | Pass   |
| Switch back → notice clears                                                                                              | e2e wallet                               | Pass   |
| Wrong network → one-click switch (adds Arc Testnet)                                                                      | e2e wallet; live O-01                    | Pass   |
| Disconnect in the extension → one Connect button, actions point to it                                                    | e2e wallet                               | Pass   |
| Rejected signature / rejected connection → message + retry                                                               | e2e wallet; live O-01, E-02              | Pass   |
| WalletConnect proposal expired / modal closed / user rejected → calm message, never a runtime error                      | e2e wallet; `test/wallet-errors.test.ts` | Pass   |
| Insufficient USDC → refused inline                                                                                       | e2e wallet; live E-01                    | Pass   |
| Page reload → silent reconnect                                                                                           | e2e wallet, owner-ux                     | Pass   |

## 3. Link crawl

`SHOW_BASE=http://localhost:3200 pnpm --filter @misthos/web exec tsx scripts/crawl.mts`: every `<a href>` reachable
from the landing page, owner home and programs, contributor pages, public audit and docs, rendered in a browser (so
client-rendered links count), signed in as owner and contributor. **96 URLs, 0 broken** (`docs/test-results/crawl.json`).
The same crawl against real Neon data (your `kency-arc-creators` program, signed in as your owner and contributor
accounts, GET only) also found 0 broken links, so the 404 you saw was state-dependent; the likeliest cause (opening a
program's join or audit link before publishing) now shows the owner a preview instead.

## 4. Error states

| State                                      | How it's tested                                                                                                                                                                                                                                                           | Result                         |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Worker down                                | e2e runs with no worker: submissions stay "Queued" and the UI says so; live E-03 kills the worker mid-round                                                                                                                                                               | Pass                           |
| X / GitHub / Anthropic errors and timeouts | agent: "retries on 429/5xx, not on auth failures", "treats 404 as not found and rate limits as retryable", "treats a refusal as non-retryable", "rethrows retryable fetch errors, then escalates on the final attempt", "retries a transient fetch failure, then decides" | Pass                           |
| RPC failure                                | vault reads fail soft (`.catch(() => null)` → "—" and no crash); page-level failures show the error panel                                                                                                                                                                 | Code path; not injected in e2e |
| Database blip (found by live QA)           | `packages/db/test/connect-retry.test.ts`: transient connect errors retried, real errors not                                                                                                                                                                               | Pass                           |
| Expired session                            | e2e home (contributor); live E-06 (owner)                                                                                                                                                                                                                                 | Pass                           |
| Double submit                              | e2e home (one row); live C-03 ("already submitted")                                                                                                                                                                                                                       | Pass                           |
| Non-member access → 404                    | e2e home; live E-05 (page, close-round API, export)                                                                                                                                                                                                                       | Pass                           |
| Invalid input                              | wizard inline validation (live O-02, e2e), invalid link disabled (e2e home), over-balance deposit (e2e wallet)                                                                                                                                                            | Pass                           |

## 5. Responsive and themes

`SHOTS_WIDTHS=375,768,1280,1440 SHOTS_THEMES=light,dark pnpm --filter @misthos/web exec tsx scripts/shots.mts`:
18 pages × 4 widths × 2 themes = 144 screenshots in `docs/screenshots/matrix/`, each checked for horizontal overflow
(none). Before/after for this batch: `docs/screenshots/contributor-fixes/{before,after}/` (1440 and 375). Reviewed by eye;
fixes from that review: contributor totals stack on mobile, the treasury shows one Connect button, status-line spacing.

## 6. Accessibility

`pnpm --filter @misthos/web exec tsx scripts/axe.mts` (WCAG 2.0/2.1/2.2 A and AA) on 19 pages in light and dark:
**38 / 38 with no serious or critical violations** (`docs/test-results/axe.json`). Fixed along the way: 18 px tap
targets on address copy/explorer icons (now 24 px) and a dimmed sign-in step that failed contrast.
Keyboard: the e2e focus test tabs through the app shell; dialogs and drawers trap focus (Radix); every main action is a
real button or link. A full keyboard-only walkthrough of every flow was not automated (see the manual checklist).

## 7. Performance

### Lighthouse (median of 3 runs, production build, simulated mobile and desktop)

`LH_RUNS=3 pnpm --filter @misthos/web exec tsx scripts/lighthouse.mts` (before: `docs/perf/lighthouse-before.json`,
after: `docs/perf/lighthouse-after.json`).

| Page             | Form    | Performance   | Accessibility | Best practices | SEO       | LCP         | TBT          | CLS           | JS transferred |
| ---------------- | ------- | ------------- | ------------- | -------------- | --------- | ----------- | ------------ | ------------- | -------------- |
| Landing          | mobile  | 91 → **91**   | 100 → 100     | 100 → 100      | 100 → 100 | 3.5 → 3.5 s | 14 → 8 ms    | 0 → 0         | 210 → 214 KB   |
| Landing          | desktop | 100 → **100** | 100 → 100     | 100 → 100      | 100 → 100 | 0.7 → 0.7 s | 0 → 0 ms     | 0 → 0         | 284 → 287 KB   |
| Join             | mobile  | 87 → **93**   | 100 → 100     | 100 → 100      | 100 → 100 | 3.3 → 3.3 s | 259 → 21 ms  | 0 → 0         | 961 → 234 KB   |
| Join             | desktop | 100 → **100** | 100 → 100     | 100 → 100      | 100 → 100 | 0.6 → 0.7 s | 3 → 0 ms     | 0 → 0         | 961 → 234 KB   |
| Contributor home | mobile  | 91 → **93**   | 96 → 100      | 100 → 100      | 63 → 63   | 2.9 → 3.2 s | 214 → 16 ms  | 0 → 0         | 967 → 242 KB   |
| Contributor home | desktop | 95 → **100**  | 96 → 100      | 100 → 100      | 63 → 63   | 1.5 → 0.7 s | 7 → 0 ms     | 0.014 → 0     | 972 → 248 KB   |
| Public audit     | mobile  | 78 → **94**   | 96 → 100      | 100 → 100      | 91 → 100  | 6.0 → 3.1 s | 49 → 11 ms   | 0 → 0         | 760 → 254 KB   |
| Public audit     | desktop | 100 → **100** | 96 → 100      | 100 → 100      | 91 → 100  | 0.7 → 0.5 s | 0 → 0 ms     | 0 → 0         | 760 → 254 KB   |
| Owner overview   | mobile  | 84 → **95**   | 100 → 100     | 100 → 100      | 63 → 63   | 2.6 → 2.7 s | 278 → 116 ms | 0.162 → 0.024 | 981 → 737 KB   |
| Owner overview   | desktop | 100 → **100** | 100 → 100     | 100 → 100      | 63 → 63   | 0.6 → 0.7 s | 5 → 0 ms     | 0.002 → 0.013 | 1055 → 811 KB  |

SEO 63 on the contributor home and owner overview is `noindex` on purpose (private pages). Landing mobile LCP is the
hero screenshot (now AVIF at quality 70).

### First-load JavaScript per route

Measured (before and after) in the Lighthouse table above ("JS transferred"). Per-route first-load size after this
batch, gzip, from the build manifests (`node apps/web/scripts/bundle-sizes.mjs <distDir>`):

| Route                                       | First load (gzip) |
| ------------------------------------------- | ----------------- |
| Landing                                     | 79 KB             |
| Join                                        | 91 KB             |
| Contributor page                            | 99 KB             |
| Programs you joined                         | 89 KB             |
| Public audit                                | 78 KB             |
| Owner home / program overview / submissions | 103–105 KB        |

What changed: ConnectKit replaced by our own picker; wallet code loads as islands (on click, or right after the page is
visible for returning wallets and owners); zod kept out of client bundles (`@misthos/shared` subpath exports,
`sideEffects: false`); the review drawer loads on first open; the overview header streams before vault reads.

### Load test

`pnpm --filter @misthos/web exec tsx scripts/load.mts` (15 s per target, 20 connections, production build, one DB
connection). The submit API runs as a real contributor re-submitting a link (session, origin and DB checks, no new rows).
autocannon reports p90 and p97.5; p95 lies between them.

| Target            | Requests | Req/s | p50   | p90   | p97.5 | p99   | Errors |
| ----------------- | -------- | ----- | ----- | ----- | ----- | ----- | ------ |
| Landing (/)       | 43762    | 2918  | 6 ms  | 6 ms  | 12 ms | 12 ms | 0      |
| Join page         | 5772     | 385   | 50 ms | 55 ms | 63 ms | 68 ms | 0      |
| Public audit      | 5415     | 361   | 53 ms | 56 ms | 84 ms | 99 ms | 0      |
| Submit API (POST) | 7874     | 525   | 25 ms | 27 ms | 29 ms | 30 ms | 0      |

### Database

`pnpm --filter @misthos/web exec tsx scripts/explain.mts`: 200 programs, 4,200 users, 4,000 contributors, 40,000
submissions and decisions; 11 hot queries all use indexes (`docs/test-results/explain.txt`). New migration
`0005_hot_path_indexes` (`contributors(x_user_id)`, `submissions(contributor_id, created_at)`,
`program_members(user_id)`, `payouts(contributor_id)`) is applied to Neon.

## 8. Unit, integration and contract tests

| Package             | Tests                 | Lines                                                                 | Branches | Functions |
| ------------------- | --------------------- | --------------------------------------------------------------------- | -------- | --------- |
| @misthos/shared     | 42 passed, 4 skipped  | 93.1%                                                                 | 85.7%    | 81.5%     |
| @misthos/agent      | 148 passed, 1 skipped | 89.6%                                                                 | 73.0%    | 89.3%     |
| @misthos/db         | 12 passed             | 73.2%                                                                 | 60.0%    | 54.2%     |
| @misthos/web        | 92 passed             | 89.4%                                                                 | 80.6%    | 82.6%     |
| @misthos/worker     | 12 passed             | 87.4%                                                                 | 75.4%    | 66.7%     |
| contracts (Foundry) | 76 passed + 2 fork    | MisthosVault 99.4% lines, 100% branches, 100% functions; factory 100% |          |           |

Skipped tests are live checks gated on credentials (`LIVE=1`). Coverage reports: `docs/test-results/coverage/`.
Foundry: `pnpm --filter @misthos/contracts test`, `forge coverage --ir-minimum`; fork suite with
`ARC_FORK_RPC=https://rpc.testnet.arc.io`.

New tests for this batch's fixes: `wallet-errors`, `contributor-steps`, `status-line`, `cache-codec`,
`program-math` (copy grammar), `submissions` (source names), `domain`, `connect-retry` (db), `checks`
(boundary message), and the e2e specs above.

## 9. CI on a clean clone

A fresh `git clone` of commit `f355b3d` (no `.env`, Node 22, pnpm 12.6, Foundry) running exactly the steps in
`.github/workflows/ci.yml`:

| Step                                                             | Result              |
| ---------------------------------------------------------------- | ------------------- |
| `pnpm install --frozen-lockfile`                                 | Pass                |
| `pnpm typecheck`                                                 | 6 / 6 packages pass |
| `pnpm lint`                                                      | 6 / 6 pass          |
| `pnpm test` (incl. Foundry)                                      | 6 / 6 pass          |
| `NEXT_PUBLIC_CHAIN=arc-testnet pnpm --filter @misthos/web build` | Pass                |

The browser e2e and live QA aren't in CI yet (they need Chromium, and live QA needs funded testnet wallets and API
keys); that's planned for the deployment phase.

## 10. Bugs found by testing (and fixed)

| Found by                                                                                                                             | Problem                                                                                                                                                                                                                                                           | Fix                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Live QA O-01 ([screenshot](test-results/failures/live-O-01.webp))                                                                    | A transient Neon "Authentication timed out" made `/app` an unstyled server error page                                                                                                                                                                             | Connect-level retry for transient errors; root and global error boundaries                                                                                                                                                                                      |
| Live QA O-02 ([screenshot](test-results/failures/live-O-02.webp), [the lost click](test-results/failures/live-O-02-lost-click.webp)) | The first Continue click on the wizard was lost: a field's error ("Too small: expected string to have >=10 characters") stayed visible while typing and disappeared on blur, which moved Continue 22 px between mousedown and mouseup. Reproduced 4/4 at 1360×900 | Errors clear as soon as the value is valid; validator messages in plain words ("Use at least 10 characters."); steps kept in React state and mirrored to the URL (instant, no server round trip). Regression test in e2e owner-ux; final live run had 0 retries |
| Live QA (harness crash)                                                                                                              | Neon closed an idle connection and `pg` raised an unhandled `'error'`: the same would have crashed the web server or worker                                                                                                                                       | `pool.on("error")` in `createDb` (logged, pool reconnects); test in `connect-retry.test.ts`                                                                                                                                                                     |
| Live QA E-01 ([screenshot](test-results/failures/live-E-01.webp))                                                                    | "That's more than your wallet holds." shown twice                                                                                                                                                                                                                 | Said once; the button says "Fix the amount above."                                                                                                                                                                                                              |
| Live QA C-05 ([screenshot](test-results/failures/live-C-05.webp))                                                                    | Connected GitHub shown without "@" and not linked                                                                                                                                                                                                                 | "@login" linked to the profile                                                                                                                                                                                                                                  |
| Live QA A-01                                                                                                                         | "Posted at 01:03 UTC, outside this round (01:03 UTC to …)" read as a contradiction                                                                                                                                                                                | Near a boundary: "Posted 5 seconds before this round started"                                                                                                                                                                                                   |
| Lighthouse                                                                                                                           | Hydration mismatch on owner pages (console error)                                                                                                                                                                                                                 | Hydration-safe wallet state                                                                                                                                                                                                                                     |
| Lighthouse / axe                                                                                                                     | Small tap targets, low-contrast disabled step                                                                                                                                                                                                                     | 24 px targets, muted colour                                                                                                                                                                                                                                     |
| e2e                                                                                                                                  | Wallet islands each reset wagmi's connection                                                                                                                                                                                                                      | One hydrating provider per page, context for the rest                                                                                                                                                                                                           |
| Lighthouse                                                                                                                           | `/app` slow for owners with many programs (one RPC per program)                                                                                                                                                                                                   | List vault reads cached 15 s; a program's own pages read fresh                                                                                                                                                                                                  |
| Screenshot review                                                                                                                    | Contributor totals broken on mobile; three Connect buttons on Treasury                                                                                                                                                                                            | Stacked on mobile; one Connect per page                                                                                                                                                                                                                         |

Nothing open. The harness still records the page state and a screenshot if a wizard click ever fails to advance.

## 11. What could not be tested automatically

These need a real person, account or extension. Everything else above ran unattended.

1. **Real Sign in with X** (X's consent screen; our callback is tested by simulation and unit tests).
2. **Real Connect GitHub** (GitHub's consent screen; callback simulated in live QA C-05, OAuth code unit-tested).
3. **Real wallet extension popups** (MetaMask/Rabby/Coinbase): the injected test wallet behaves like one, but the
   extensions' own UI, account picker and network-add prompt are theirs.
4. **WalletConnect with a phone wallet** (QR scan, approve on the phone, and letting a request expire for real).
5. **A complete keyboard-only and screen-reader pass** of the main flows.

### Manual checklist (about 15 minutes)

1. **X:** open your join page in a private window → Sign in with X → approve → you're back with step 1 ticked.
2. **GitHub:** on your contributor page → Account → Connect GitHub → approve → "GitHub connected." and "@yourlogin
   verified". Submit one of your own merged PRs; it should pass ownership.
3. **MetaMask (or Rabby):** in the owner app, switch accounts in the extension → the wallet chip shows an amber dot
   ("Other account in wallet"), no banner and **no signature prompt**. Click the chip (or any vault action) → compact
   dialog → "Choose account in wallet" opens the extension's account picker. Switch back → the dot goes. On a
   contributor page the same switch only adds a line under the payout wallet.
4. **Network:** switch the extension to Ethereum → chip shows "Wrong network" → click it → "Switch to Arc Testnet" →
   the extension asks once (adds the network if missing).
5. **WalletConnect:** Connect → WalletConnect → scan with a phone wallet → approve. Then try again and let the QR sit
   for 5 minutes (or close it) → "Connection request expired. Try again." with a retry, and no error overlay.
6. **Coinbase Wallet:** if installed, it appears in the picker; if not, "Not installed · Get it".
7. **Keyboard:** Tab from the top of `/app` through the sidebar, open the switcher with Enter, pick a program with the
   arrows; on a program, open a submission with Enter and close it with Escape. A ring should be visible at every step.
