# Misthos — Progress

**Current phase:** Phase 7 done: live on Arc testnet at https://misthos-iota.vercel.app (web on Vercel, worker on
Railway, Neon). Repository public. No mainnet without the owner's explicit OK.
**Last updated:** 2026-10-05
**Deadline:** Oct 10, 2026 11:59 PM ET

## Reduced scope (owner decision, 2026-10-02)

- **Keep:** vault + tests + testnet deploy, program setup, X sign-in + wallet signature, submissions (X posts,
  GitHub PRs via public API, articles), agent pipeline (fetch, deterministic checks, LLM scoring, prompt-injection
  defense, decision engine, signed decision records), review queue, testnet payout rounds, public audit page with
  "Verify a decision", simple landing page, short docs, metrics page.
- **Cut:** treasury/USYC, CCTP, EURC, keyboard shortcuts,
  notifications, Discord/YouTube.
- Phase 3 tests use saved fixtures (no API spend). Both agent models: `claude-haiku-4-5-20251001`.

## Decisions (confirmed 2026-10-02)

1. Agent executor = Circle smart-contract wallet on Arc testnet. Decision signatures must verify for **both**
   ERC-1271 (SCA) and EOA signers (viem `verifyMessage` covers both).
2. Neon (Postgres) + Railway (worker) + ConnectKit.
3. `~/CLAUDE.md` Latch API-routing rule does not apply to this project; secrets come from root `.env`
   (gitignored, never committed or logged). Mainnet deploys and real funds need explicit owner OK.

## Done (UI polish + agent context + small features, 2026-10-06)

- **UI polish:** landing header shows no account details ("Open app" only) and a "See it live" hero CTA; split
  sign-in page; the wallet never opens by itself; compact account chip (blockies identicon, status dot, menu) for
  owners and contributors; "Back to site" removed (logo → landing); compact "Switch to your owner wallet" dialog.
  Before/after in `docs/screenshots/polish/`.
- **Context for the agent:** wizard step 2 and Settings; the worker reads the owner's text and up to 3 links once
  (guarded fetch, pages with instructions for the agent left out, identical reads cached a day) and drafts a
  summary, key facts and on/off-topic themes the owner edits; saved versions (`program_contexts`). The judge
  (`judge-v4`) gets it as a trusted `<program_brief>`, rates relevance and checks claims against key facts
  ("unverifiable" instead of guessing); engine `rules-v6` (OFF_TOPIC, CONTRADICTS_BRIEF, MISSING_REQUIRED). Each
  signed decision records the context version and hash. Join page and wizard preview show About and "must include".
- **Second looks** (once per submission, 280 chars, 5 a day) → owner "Needs you" + drawer; the owner's signed
  decision resolves it (audited). **Per-round submission cap** (default 5, refused before any API cost).
  **Minimum X followers** (default 0 → review). Rules shown on the join page.
- Migration `0009` applied to Neon. Live checks: real context read (Circle blog) and real judge with a brief
  (contradiction → review quoting both sides; off-topic → rejected).

## Done (fix-verification findings N-1…N-13, 2026-10-05) — main frozen after this

- **N-1** one worker run per round (database lease, renewed before every transaction); payouts carry their on-chain
  round id and release/record act only on the id that was sent. **N-2** re-plan ids from a persistent counter; payout
  re-checks cached 6 h. **N-3/N-4/N-5** articles: dates untrusted, never "the original", conflicts go to a person;
  authors only from structured metadata; articles never auto-approve (`R9B_ARTICLE_REVIEW`, `rules-v5`); the agent
  never rejects or supersedes an earlier decision (late copies are held for review). **N-6** under-funded vault →
  "Vault needs funds", approval kept, waits. **N-7** stately `round-run-once` queue, one key per round. **N-8**
  Verify: vault from the payout event, factory check, agent read at the payout's (or decision's) block. **N-9**
  GitHub secondary rate limit retried, earliest landing date. **N-10** paraphrased judge notes → review. **N-12**
  approval route writes only on the approved id. **N-13** worker `/health` hides error text.
- Migration `0008` (lease, re-plan counter, payout round ids with backfill, re-check time) applied to Neon.
- Live on Arc testnet (`live:crash`, `docs/test-results/live-crash.txt`): crash after `executeRound` → paid once;
  two concurrent workers on one round → one ran it, one propose + one execute, each item paid once.
- From here **main is frozen**: no feature or audit work, only critical fixes, each tested before deploying.

## Done (independent audit fixes + Neon free-tier worker, 2026-10-05)

- **Independent audit** (`docs/INDEPENDENT_AUDIT.md`, with a fix-status table): all High and Medium findings
  fixed with regression tests. F-01 round transitions follow the chain; items are released only if the vault says
  unpaid. F-02 wallet changes deferred while a payout is in flight; failing payees dropped and carried over
  (cancel + re-plan). F-03 duplicates count only verified priors; earlier platform time wins; late originals reject
  the copy. F-04 article author metadata only. F-05 commits must be on the default branch, dated by PR merge.
  F-06 docs say the compromised-agent bound is `maxPerDay`/day; the agent applies the threshold to its 24 h total.
  F-07 judge injection flags escalate (`rules-v4`). F-08 periodic round recovery incl. awaiting approval. F-09 Verify
  pins the signer to the vault's on-chain `agent()`. F-10 GitHub id at payout. F-11 metrics count each submission
  once. Low/Info documented with status. Contract audit tests renamed `test_ONCHAIN_*` (vault is immutable).
- Migration `0007`: payouts unique per (round, contributor) only among non-failed rows (re-planned rounds). Applied
  to Neon.
- **Live crash test** (`pnpm --filter @misthos/worker live:crash`, output in `docs/test-results/live-crash.txt`):
  worker SIGKILLed right after `executeRound` on a throwaway testnet vault; a fresh worker recorded it from the
  chain; a third run did nothing; each contributor paid exactly once (1 `RoundExecuted`, 2 `PayoutExecuted`).
- **Neon free tier:** the worker no longer polls. It drains the queues on wake (web app `POST /wake` with
  `WORKER_WAKE_SECRET` after each enqueue), every 15 min (`WORKER_TICK_MINUTES`) and for due retries, closing its
  connections in between so Neon can suspend. Worker `GET /health` answers from memory; `/api/health/worker` relays
  it without touching the database. Measured on Neon: before ~369 transactions/min with 5 pg-boss
  connections always open (compute up continuously); after ~2.4/min, no worker connections between drains, and the
  compute suspended and restarted on its own after the deploy. Expected ~2 CU-h/day (awake ~5 min per 15-min tick).

## Done (UX and bug sweep before submission, 2026-10-05)

`docs/UX_SWEEP.md`: 28 findings, all fixed, with before/after screenshots (`docs/screenshots/ux-sweep/`). Every page
and state for every role at 375/1440 px in light and dark, against a production build with real data
(`apps/web/scripts/sweep.mts`: screenshots, console, failed requests, titles, overflow, dates, axe).

- **High:** public audit showed superseded decisions as current; "fraud caught" counted late work; "Programs you
  joined" read "Approved 0" for paid work (now Submitted · In review · Approved, not paid yet · Paid).
- **Medium:** overview counted all-time submissions under the current round; times in four formats and two
  timezones (now `2026-10-05 09:29 UTC` everywhere); soft own-work similarity labeled "Copied"; landing rounded
  0.366 up to 0.37; unknown audit links answered 200; long "Needs you" lists; truncated program names; stretched
  grids (gap above `/c`'s heading, tall cards, misaligned sections).
- **Low:** tab titles (404, sign-in, no access, round numbers), units on amount columns, "closes in" everywhere,
  "View round", cooldown "None", skeleton placeholders, docs/board/metrics axe issues, versioned public cache keys.
- **Tests:** web 131 (+ joined counts, fraud vs late work, current-decision-only, severity-aware flag copy),
  e2e 21/21.

## Done (Phase 7: deployment on Arc testnet, 2026-10-05)

- **Web (Vercel):** project `misthos`, root `apps/web`, Node 22, built from GitHub `main` (pushes deploy
  automatically) at https://misthos-iota.vercel.app (`misthos.vercel.app` was taken). Env: only what the web app
  reads (app URL, chain, WalletConnect id, agent SCA address, `DATABASE_URL`, a production-only `SESSION_SECRET`, X
  and GitHub OAuth client credentials); no signing keys, entity secret or deployer key. Firewall rule "API rate
  limit (M-4)": 100 req/min/IP on `/api/auth/*`, `/api/public/*`, `/api/contributor/*` (429), published.
- **Worker (Railway):** project `misthos`, service `worker`, from GitHub `main` via `apps/worker/Dockerfile` +
  `railway.json` (restart ALWAYS, never sleeps, 1 replica; redeploys on changes to the worker's packages). Env:
  Neon, X bearer, GitHub token, Anthropic, Circle API key + entity secret + wallet id/address,
  `AGENT_BACKEND=circle` (no EOA key in production). Logs carry level names. The local worker and dev server were
  stopped first so only one worker serves the database.
- **Database:** same Neon database; all 7 migrations applied.
- **OAuth / wallets:** X callback `https://misthos-iota.vercel.app/api/auth/x/callback` and GitHub callback
  `/api/auth/github/callback` added by the owner (localhost kept); Reown allowlist has the production domain.
- **Smoke test (all pass):** landing, docs, join and audit pages; Verify on the live site (5/5 checks incl. the
  on-chain payout match); owner SIWE sign-in → owner app and wizard (nonce replay refused, cross-origin refused);
  owner's real X sign-in and Connect GitHub (kenil1710); a real submission processed by the Railway worker in ~3 s
  (the "1/" post of the owner's thread: OUT_OF_WINDOW for Round 2 + soft NEAR_DUPLICATE, rejected, signature
  verified on Arc).
- **First production payout:** Round 1 of Kency Arc Creators closed on the owner's instruction (audit actor
  `system`); the Railway worker proposed and executed it: 0.36 USDC to the contributor's payout wallet
  ([0x2ccd33fc…](https://explorer.testnet.arc.io/tx/0x2ccd33fcb77ed5bb41af10bfa4e9f59b780f774a2c242bebdf39b29546da321a)),
  `decisionHash` = hash of the signed decision. Round 2 opened automatically (2026-10-05 09:29 → 10-12 09:29 UTC);
  the owner closes it manually on Oct 8–9.
- **Wallet UX:** the full-width amber wallet banner is gone everywhere. Contributors: a one-line note under the
  payout wallet ("Connected wallet differs from your payout wallet · Use this wallet instead"), and a compact "Pick
  the new wallet" dialog only when changing the payout wallet while the extension is still on it. Owners: amber dot
  on the wallet chip; the compact fix dialog only when an action needs the owner wallet (deploy, fund, withdraw,
  approve round, limits, pause). e2e (21/21) and screenshots (`contributor-wallet-note`, `-pick-dialog`) updated.
- **README:** live URL, the real payout, a deployment table.
- **Repository public** after a final scan: gitleaks over all commits clean; none of the 11 secret values in `.env`
  appear anywhere in history; only `.env.example` was ever committed.

## Done (Release audit before Phase 7, 2026-10-05)

Full report: `docs/SECURITY_AUDIT.md` (severity per finding). No critical findings.

- **Fixed (high):** reviewer overrides of an item already in a planned round were recorded but the vault still paid
  it; route, worker (conditional write) and review drawer now refuse with the on-chain way to stop it. `ws` and
  `lodash-es` advisories pinned to patched versions (`pnpm-workspace.yaml` overrides).
- **Fixed (medium):** agent rounds capped at 50 payouts (a 200-payout `proposeRound` is 30.4M gas, over Arc's 30M
  block; `MisthosVault.gas.t.sol` guards it); injection pre-check catches mode-switch / role-label / "pay the
  maximum" phrasing in any thread post; rate limits on SIWE nonce/verify, X and GitHub sign-in starts, wallet
  proofs, submissions (burst) and public decision lookups.
- **Fixed (low):** SSRF blocklist adds 6to4 and Teredo; `setProgramStatusAction` validates its input.
- **Checked:** contracts line by line + slither (7 results, all reviewed); authz/origin/validation matrix for every
  route; signing keys only in the worker; 0 secret values in client/server bundles or logs; gitleaks over all
  history clean (4 public addresses allowlisted); `pnpm audit` 3 high → 1 (unreachable `braces`, build-time CLI).
- **Code quality:** removed dead files (7 unused UI components, a stray scratch script) and 5 unused functions, an
  unused dependency (`@next/bundle-analyzer`); `shadcn` moved to devDependencies; `knip.json` declares script
  entry points; no TODOs; `console.log` only in CLIs; strict TS + `noUncheckedIndexedAccess` everywhere.
- **Docs:** README "Try it in 2 minutes" (verify an agent-signed record with `cast` against Arc:
  `docs/examples/decision.json`), repo tree; ARCHITECTURE/SECURITY/docs site updated for threads, the points rule,
  re-processing, the 50-payout cap and overrides in payout.
- **Re-processing:** the only real X submission (kency-arc-creators) was re-processed earlier today (judge-v3,
  4-post thread, approved 0.36 USDC, supersedes the single-post escalation). The other 105 X submissions are QA/demo
  fixtures (reserved fixture links), left as they are.
- **Earlier today:** Circle entity secret reset and restored in `.env` (old recovery file marked invalid); proofs
  on Arc (Circle-signed decision; 0.01 USDC payout on the showcase vault); Connect GitHub verified with a real
  account; X threads read in full; judge-reject never priced; `requireMerged` scoped to PR categories (migration
  0006).
- **Checks:** typecheck, lint and tests green (contracts 77 + 1 skipped, agent 172 + 1, web 124, shared 43 + 4 live, db 12,
  worker 12).

## Done (contributor-test feedback + full test pass, 2026-10-03)

Tracked as CF-1 … CF-16 in `docs/UX_AUDIT.md`; every automated check and its result is in `docs/TEST_REPORT.md`.

- **Wallet:** ConnectKit replaced by our own picker (MetaMask, Rabby, Coinbase Wallet, WalletConnect). Prompts only
  follow a click; account/network mismatches show a calm notice with one-click fixes; silent reconnect; WalletConnect
  "Proposal expired" and every other connector rejection is caught and shown as a message with a retry.
- **Homes:** `/app/programs` cards with "Needs you"; `/c` programs you joined; single-program owners land in their
  program; the landing header knows who's signed in (non-secret `misthos_hint` cookie).
- **Program overview:** status line, "Needs you" first, "Get your first submissions" until there's activity.
- **404s:** owner preview for unpublished programs' join/audit pages; audit page empty state; better 404; link crawl
  (0 broken).
- **Copy:** proper source names everywhere; next steps tailored to the program's sources; "A perfect thread or post
  (10/10) earns …"; styled disclosure.
- **Performance:** wallet code only where needed, zod out of client bundles, streamed overview header, cached public
  queries and list vault reads, migration `0005_hot_path_indexes` (**applied to Neon**), backoff polling, optimistic
  submit and review. Lighthouse 90+ on the five pages measured (numbers in the test report).
- **Resilience:** transient Neon connection errors are retried before any query runs; an idle connection
  dropped by Neon no longer crashes the server or worker; root/global error boundaries.
- **Tests:** new e2e specs (wallet, home), unit tests for every fix, axe, crawl, Lighthouse, load, EXPLAIN scripts in
  `apps/web/scripts/`; e2e now runs against a production build.

## Done (owner-feedback fixes, 2026-10-03)

Everything from the owner's hand test of the owner flow, tracked as OF-1 … OF-19, SEC-1 and CJ-1 … CJ-4 in
`docs/UX_AUDIT.md` with a test for each. Before/after screenshots: `docs/screenshots/owner-fixes/{before,after}/`.

- **Round scheduling (blocker):** wizard defaults Round 1 to "Now" (or a scheduled start shown as local · UTC ·
  starts in); Settings "Round schedule" card edits length/start and can "Start round N now" (audited
  `round.started_early` / `program.schedule_updated`); scheduled rounds show "Scheduled · starts in X" and can't be
  closed (UI disabled, API 409). **kency-arc-creators Round 1 was started early on 2026-10-02 17:03 UTC** via
  `apps/web/scripts/start-round-now.mts` (audited as `support:misthos` with a reason); it ends 2026-10-09 17:03 UTC.
- **Wizard:** step in the URL and a draft saved on this device (survives back/reload), 640 px column + live join
  page preview, slug filled from the name, "how a score becomes USDC", limits derived from the rubric until edited,
  7-day rounds, inline limit warnings.
- **Shell:** switcher lists drafts immediately, wallet reconnects on load (allowed wallets discovered synchronously),
  new sidebar footer, dev badge off, focus ring only on keyboard focus, curated wallet list (MetaMask, Rabby,
  Coinbase Wallet, WalletConnect) with Arc Testnet added on switch.
- **Screens:** submissions empty state, audit log with actor and human labels, treasury send-to/copy/explorer and
  reasons on disabled buttons (24 h bar turns amber near the cap), one wallet status per page, richer welcome.
- **Security — GitHub ownership via OAuth:** "Connect GitHub" (no scopes, state + PKCE bound to the session,
  token revoked right after reading the profile). Verified GitHub id/login stored on the user and copied to every
  membership; the agent pays GitHub work only when the PR/commit author id equals the verified id; GitHub links
  are refused until connected; a typed username is ignored. Migration `0004_github_oauth` **applied to Neon**.
  Callback: `${NEXT_PUBLIC_APP_URL}/api/auth/github/callback` (registered as `http://localhost:3000/...`).
- **Contributor journey:** "Share on X" (overview, checklist, settings), "You're in. Here's what to do next" with
  the program rules, round countdown + "This round so far", join page "How it works" (4 steps) + an example of good
  work.
- Tests: web unit + `e2e/owner-ux.spec.ts` (new) and `e2e/owner-and-join.spec.ts` green; agent spoofing cases;
  full `turbo typecheck lint test build` green.

## Done (Redesign v2 — Stage 3: guided flows, contributor journey, verify) — awaiting review

- **Wizard** (`/app/programs/new`): full screen (no rail, `components/app/focus-frame.tsx`), 4 steps with a stepper
  header and "Save and exit", live join-page preview, step headlines shared with the server first paint
  (`wizard-steps.tsx`). Browser Back/Forward between steps, join link filled from the name and editable.
- **Ready + guided setup:** "Your program is ready" (`/ready`) → `/setup`: deploy → fund (deposit suggestions from
  the program's limits) → publish → "You're live"; the step follows the program's real state (`lib/setup-flow.ts`),
  "Finish later" returns to the overview, whose setup track links back.
- **Contributor journey:** "Your contributions" with paid / this round / approved-not-paid, a personal timeline
  (`lib/contributor-timeline.ts`), each submission's full journey and "Verify this decision"; programs-joined home.
- **Public audit + Verify:** the five checks show before anything is pasted and reveal one by one
  (`lib/verify-view.ts`); round receipt page.
- **Docs theme, empty states, errors:** Fumadocs on the app palette; submissions/contributors empty states; 404,
  owner and contributor error panels.
- **Fixes on 2026-10-05:** the wizard's server-painted placeholder fields carried the real fields' labels, so anything
  that found fields by label (tests, autofill, assistive tech) could type into the placeholder and lose the text
  when the form mounted — now `aria-hidden` and unlabelled. e2e gets its own `CIRCLE_AGENT_WALLET_ADDRESS` instead of
  relying on the developer's `.env`. New e2e checks: join link editable and kept, ready → setup reaches "Deploy vault".
- **Checks (2026-10-05):** `turbo typecheck lint test` 18/18 (web 124, agent 148, shared 42, db 12, worker 12,
  contracts 76); e2e 21/21 on a production build; axe 0 serious/critical on 15 Stage 3 screens × 2 themes (run on the
  e2e stack because the showcase reseed needs the Circle entity secret, see Known issues). Lighthouse mobile 92–99,
  desktop 100 on 13 pages (`docs/perf/lighthouse-v2-stage3.json`, 2026-10-03).
- Screenshots: `docs/screenshots/v2/stage3/` (1440 and 375, light and dark).

## Done (Redesign v2 — Stage 2: owner app, palette, navigation) — awaiting review

- **Owner app**: icon+label rail (switcher, wallet chip, Back to site), top bar (round pill, Needs-you bell, Share
  join link, theme); overview hero, 5-step setup track → "Setup complete", Needs-you and recent-decision cards;
  submissions list + board by stage; review drawer with the journey stepper and the agent's reasoning trace;
  rounds with the lifecycle stepper and the payout moment; treasury balance card; settings section nav. Pure,
  tested logic in `lib/journey.ts` and `lib/round-lifecycle.ts`.
- **Palette**: back to the pre-Stage-1 stone + emerald tokens (light and dark), system theme default; v2 layout,
  type and illustrations kept.
- **Navigation** (`docs/NAVIGATION.md`, `e2e/navigation.spec.ts`): Back closes dialogs/drawers/menu, wizard steps
  follow Back/Forward, sign-out → landing with a notice, return paths for owner/X/GitHub sign-in, no-access page,
  tab titles.
- **Performance**: wallet code loads after first paint, when idle and on screen (owner mobile JS ~740 → ~250 KB);
  vault reads shared for 15 s and expired by the owner's own transactions; paused banner streamed. Lighthouse mobile
  91–94, desktop 100 on all 8 measured pages (`docs/perf/lighthouse-v2-stage2.json`); axe 46/46 (both themes).
- Screenshots: `docs/screenshots/v2/stage2/` (1440 and 375, light and dark).

## Done (Phase 6.5 — UX redesign + full live QA)

- **UX audit** (`docs/UX_AUDIT.md`): every owner, contributor and public flow against Nielsen's heuristics;
  8 critical, 22 major, 15 minor issues. All critical and major fixed; minors: 12 fixed, 2 partly, 1 open.
- **Redesign**: sidebar shell with program switcher and review badges (menu sheet on mobile); breadcrumbs and one
  page header everywhere; centered two-step sign-in; "Get your program live" checklist (deploy, fund, publish and
  share, first submission, first payout) and "Finish setting up" on the overview; every on-chain action through one
  flow (confirmation with exact amounts → wallet → pending with explorer link → confirmed/failed with a sentence and
  Try again; toasts); wallet readiness with one-click fixes (connect, switch network, wrong account); session expiry
  handled everywhere; withdraw and pause/resume (new); paused-vault banner; limit help text in plain words; jargon
  tooltips with doc links; humanized review drawer and override confirmation; wizard validates on blur; contributor
  flow mobile-first with a join stepper, "what happens next", how-to-fix guidance on rejections, Verify links, wallet
  change behind a button with the cooldown stated, GitHub username editable after joining.
- **Live QA** (`docs/QA_REPORT.md`): five fresh testnet wallets (Circle faucet API returned 403 for our key; funded
  from the deployer), a real EIP-1193 test wallet in Playwright, the real agent (Circle SCA, Claude, pg-boss) against
  Neon and Arc testnet; QA programs marked demo. Final run **39/39**. 11 bugs found and fixed (judge discarding
  sound judgments over long notes; GitHub username not settable after join; non-member 200 instead of 404; over-cap
  demo crash; 375px overflow; no withdraw/pause UI; worker crash left rounds stuck 15 min; next round not opened
  after a crash; transient enqueue failure; two minor UI). About 0.16 test USDC of gas over 10 runs; 4.05 test USDC
  still in the QA wallets.
- **Screenshots**: `docs/screenshots/redesign/{before,after}` with an index; `docs/screenshots` re-taken (67).
- **Tests**: worker 12 (startup recovery), agent 147 (judge trimming, next round after crash), web 54, contracts 76,
  shared 42, db 7; browser e2e updated for the new flows.

## Done (Phase 6 — Landing + docs)

- **Screenshot-review fixes (10):** "N items waiting for you"; truthful vault status for contributors ("Not in vault
  yet" / "Wallet change pending in vault"; the old "registering" label assumed a pending registration that only
  happens after approved work or a round); "Signing as 0x…" instead of Connect when the owner is connected; 0h
  cooldown warning in the wizard and settings (default stays 24h); word-boundary wrapping in the review drawer
  (hashes only break anywhere); audit log in USDC with explorer and Verify links; round detail tx + per-record Verify
  links; "—" for no GitHub; relative feed times with UTC on hover; receipt Work link styled as a link.
- **Design system:** warm stone neutrals (light #FAFAF9, dark ~#111110 with layered surfaces, no pure white text),
  three text levels (`foreground`, `soft`, `muted`), emerald used sparingly and calmed in dark mode.
- **Landing** (`/`): centered hero with the real submissions screen in a theme-aware frame (cropped to a readable
  width on mobile), metrics strip from non-demo data only (hidden at zero; currently hidden), problem, 4-step how it
  works, two real signed decisions (one approved, one rejected) with Verify links, guardrails with the featured
  vault's real caps, audit trail with a real verified decision, Arc + Circle (only what's used), FAQ, final CTA,
  footer. ISR every 5 min; renders without a database. Subtle reveal on scroll (220ms, reduced-motion safe),
  count-up only on metrics.
- **SEO:** metadata base, canonical, Open Graph + Twitter card, designed OG image (`opengraph-image.tsx`, Geist
  vendored under OFL), SVG favicon + apple icon, theme-color, sitemap (static pages + real published programs),
  robots.
- **Docs** (Fumadocs 16 at `/docs`, app tokens): Introduction, Quickstart for owners (screenshots), Guide for
  contributors, How the agent decides (every flag with severity, every rule R1–R10), Guardrails and the vault
  (roles, limits with revert names, testnet addresses + explorer links), Audit trail and verification (viem recipe
  to recompute the hash, check the signature, the payout hash and the event), Security and privacy, Architecture
  (Mermaid, theme-aware), FAQ.
- `GET /api/public/decisions/:hash` now also returns `X-Decision-Signature` and `X-Decision-Signer` headers so anyone
  can verify without the UI.
- **Repo docs:** README for judges, ARCHITECTURE.md, SECURITY.md, complete `.env.example`.
- **Lighthouse** (production build): landing 90/100/100/100 mobile, 100/100/100/100 desktop; docs 92+/100/100/100.
  Fixes made: hero images eager + high priority, quality 70; no prefetch of `/app` (it pulled ConnectKit into the
  landing's network); list semantics.
- **Screenshots:** one combined reseed (vault topped up 1.2 test USDC,
  [deposit](https://explorer.testnet.arc.io/tx/0xa81df9a21a0fab45b1ad750f1df56ee0b8026c884840e2ae5a658c65547204f4);
  round 1 paid on Arc,
  [execute](https://explorer.testnet.arc.io/tx/0x5e8af1570d3bd69b3ca02fddbb11ac4a2311f1eba7629c29e741c3b89ecda611)).
  `docs/screenshots/` now also has landing (light/dark, desktop/mobile), docs and the new-program wizard; landing
  crops in `apps/web/src/assets/landing/`, docs crops in `apps/web/public/screens/`.

## Done (Phase 5 — App UI polish)

- **Public pages** (no sign-in): `/p/[slug]` audit page (totals: USDC paid, contributors paid, submissions reviewed,
  fraud caught, rounds paid; every payout with handle, amount, round, payout decision hash, tx; rounds; recent
  decisions with reasons) and `/p/[slug]/rounds/[roundId]` receipt (propose/approve/execute txs, decision root,
  payouts with each decision record). Demo programs carry a visible "Demo program" label.
- **Verify a decision** (`/api/public/verify`, rate-limited 20/min/IP; `lib/verify.ts`): paste or pick a record →
  re-canonicalize + keccak256 → published by Misthos (and whether superseded) → agent signature (ECDSA or ERC-1271
  `isValidSignature` on Arc) → payout commitment (keccak of the payout's sorted item hashes) → receipt's
  `PayoutExecuted` event from the program's vault (payoutId, decisionHash, amount, recipient). Rendered as a proof chain;
  rejected decisions verify through the signature step. 9 tests incl. tampering, forged signature, chain mismatches.
- **Owner app**: `/app` overview across programs (vault balance, next payout forecast capped by round limits,
  submissions by status, fraud caught, recent decisions feed, alerts for rounds awaiting approval and payee changes);
  program tabs Overview · Submissions (filters + review drawer) · Contributors (+ detail: earnings, submissions,
  payouts, wallet history) · Rounds · Treasury · Audit log (filters, CSV/JSON export with formula-injection guard) ·
  Settings.
- **Contributor**: `/c/[slug]` earnings, approved-unpaid, reviewed counts and payout history with receipt + tx links.
- **Metrics** `/app/admin/metrics` (founders: `FOUNDER_WALLETS` env or `users.is_founder`): programs, contributors,
  reviewed, auto-approved %, escalated %, fraud by flag, USDC paid testnet vs mainnet, rounds, median review time,
  X and LLM spend; "Copy for submission form". Demo programs excluded (tested).
- **Quality floor**: shared UI kit (PageHeader, Stat, EmptyState, Notice, Section, TableFrame), skeleton `loading.tsx`
  and human `error.tsx` per area, 404 page, mobile nav row, mono tabular numbers, UTC timestamps everywhere,
  copy + explorer on every address/hash. Fixed from screenshot review: review drawer horizontal overflow, overview
  side panel stretching, same-day OUT_OF_WINDOW message ("Posted at … UTC" when a boundary shares the day).
- **Screenshots** (`docs/screenshots/`, 37 PNGs, light + dark at 1440px, 3 at 375px): from a demo program
  (`is_demo`) seeded into the throwaway DB by `apps/worker` `seed:showcase` — scripted content, but real SCA-signed
  decisions, real checks, and a real round paid on Arc testnet
  ([tx](https://explorer.testnet.arc.io/tx/0xbce6ca812ec35f36e1474f6109cb7fd4b8ed6aa581c74278e7dce54082d151fa)) from the
  live vault. Recapture: start db-server + app on :3100, `seed:showcase`, then `apps/web/scripts/screenshots.mts`.

## Done (Phase 4 — Payout rounds)

- **Circle agent wallet** (`pnpm --filter @misthos/worker circle:setup`, idempotent): entity secret generated and
  registered (recovery file in `~/misthos-circle-recovery/`, outside the repo), wallet set + **SCA on ARC-TESTNET
  `0x74a60caa5e6c14a33be4ebf1507a209ac61b78a1`**, deployed with one sponsored no-op tx (Circle won't sign from an
  undeployed SCA). Only the `CIRCLE_*` lines of `.env` were filled/appended. Gas Station: Circle's default testnet
  policy sponsors SCA transactions (50 USDC/day on Arc testnet); the SCA's native balance stays 0.
  `circle:probe` proves ERC-1271 signature verification on Arc, sponsored execution, and idempotency-key dedupe.
- **Signer / executor interfaces** (`AgentSigner`, `AgentExecutor`): Circle SCA (default when configured) or the
  testnet EOA fallback (`AGENT_BACKEND=eoa`, `AGENT_PRIVATE_KEY`). Decision records are now signed by the SCA.
  Circle calls carry deterministic UUID idempotency keys derived from the action + vault + round/payee.
- **Vault from the app**: Overview → "Deploy vault" (owner tx via ConnectKit → factory, agent = Circle SCA) →
  "Fund vault" (approve + deposit). Settings → on-chain `setLimits`. Every follow-up API (`/vault`, `/limits`,
  `/deposit`, `/rounds/:id/approved`) verifies the event on-chain (contract, args, owner, agent) before recording.
  The wizard saves the draft; deploy/fund are the next steps on the program page (the vault needs the program id).
- **Payees**: joining or changing wallet enqueues `payee-sync`; the agent calls `registerPayee` (idempotent; reads
  `payeeOf` first). The cooldown is the contract's; owners see an alert for recent wallet changes.
- **Rounds** (`runRound`, worker queue `round-run`, scheduler every 60 s + "Close round now"): close → re-check every
  approved item (fresh fetch; deleted/ownership-changed items get a signed `R0_PAYOUT_RECHECK` rejection) → register
  missing payees → `planRound` (per-contributor aggregation, whole items only, ≤ maxPerPayout, ≤ min(maxPerRound,
  maxPerDay − spentInWindow), ≤ 200 payouts, payee registered + out of cooldown; the rest carry over with a reason) →
  `payoutId = keccak256(abi.encode(programId, roundId, contributorId))`, payout `decisionHash` = keccak over its items'
  sorted decision hashes, `roundDecisionRoot` = keccak over all included decision hashes → `proposeRound` →
  `executeRound` if total ≤ autoApproveThreshold, else "Approve round" for the owner, then execute. Every step reads
  chain + DB state first; tx hashes, `payout.executed` receipts and audit events are stored. Chain reverts mark the
  round failed and release its items.
- **UI**: program tabs (Overview, Rounds, Treasury, Settings); rounds list; round detail with timeline (closed →
  planned → proposed → approved → executed, tx links), payouts (contributor, wallet, amount, decision hash, tx),
  carried-over items; treasury from live vault reads (balance, deposited, paid, withdrawn, daily cap meter) +
  recorded deposits and payouts.
- **Demo** (`pnpm --filter @misthos/worker demo:cap-revert [vault] [--broadcast]`): simulates `proposeRound` from the
  agent SCA at the cap (accepted) and 1 USDC over it (reverts `PayoutTooLarge`); `--broadcast` sends it through Circle,
  which refuses at estimation (`ESTIMATION_ERROR`), so nothing lands.
- **Tests**: planner (aggregation, every cap, payee states, determinism), round job against an in-memory vault model
  driven by real calldata (auto-execute, approval path, transient retry, crash after execute, payout re-check,
  carry-over, cooldown, chain refusal, manual close, payee sync), worker queue round (decision → scheduler → paid).
- **Live rounds on Arc testnet** (`pnpm --filter @misthos/worker live:round`, throwaway DB, scripted content and
  scores, real chain + Circle SCA + SCA-signed decisions): vault
  [`0x09138198…D973`](https://explorer.testnet.arc.io/address/0x09138198c0056189727dfe809E67934c1B7fD973), funded
  5 USDC. Round 1 auto-executed 1.60 USDC (alice 1.00, bob 0.60; alice's 0.80 deferred by maxPerPayout 1.50):
  [propose](https://explorer.testnet.arc.io/tx/0x5bf1bda727ae144d23399844dd6c30bc53093e936643c991694ab80c8db452dd),
  [execute](https://explorer.testnet.arc.io/tx/0x1b22e940e2ce08647259129f3a047a0792ee222193408653ff1c59511e42cd42).
  Round 2 = 2.20 USDC > 2.00 threshold → awaited approval →
  [owner approveRound](https://explorer.testnet.arc.io/tx/0x760d0e8e1a936cc5f308d7402cf658c211cded0e75e0dca601010b2383add98e) →
  [execute](https://explorer.testnet.arc.io/tx/0x5b56ab5de70be70b56030d5dd3a6cbbc2a75c936c33be02c5f250b35f3ba29ce)
  (alice 0.80, carol 1.40). Final balances alice 1.80 / bob 0.60 / carol 1.40; vault 1.20 left, totalPaid 3.80.
  A first attempt surfaced a script bug (carol's post stamped before round 2 opened → correctly rejected
  OUT_OF_WINDOW); its vault's 2.60 USDC leftover was withdrawn by the owner.

## Done (Phase 3 — Agent core)

- **Submission flow**: `/c/[slug]` submit box with instant validation (same classifier client and server):
  supported type, program accepts the source, member with verified wallet, GitHub username for GitHub work, round open
  (rounds are created lazily as time passes), not already live-submitted (partial unique index; rejected items may be
  resubmitted), 20/day per contributor. Saves the row + `submission.created` audit event, enqueues a pg-boss job; the
  feed polls while anything is pending/processing and shows the decision text and hash.
- **URL classification** (`@misthos/shared` `classifySubmissionUrl`): X posts (any x.com/twitter.com form → post id),
  GitHub PRs (`owner/repo#n`), commits (full 40-char SHA only), articles (normalized https URL, tracking params
  stripped). The resource id is the dedupe key. Private hosts, IP literals, odd ports, credentials refused up front.
- **Fetchers** (`packages/agent/src/fetch`): X `GET /2/tweets/:id` (`note_tweet` for long posts, author expansion;
  every call logged in `api_usage` at the conservative $0.015 = $0.005 post + $0.010 user, per docs.x.com pricing);
  GitHub PR + files / commit (REST 2022-11-28); articles via `@mozilla/readability` + jsdom (no scripts) behind an SSRF
  guard (connect-time IP check incl. DNS rebinding, redirects re-validated, 10 s, 2 MB, HTML only). Results cached in
  `fetched_resources`; deleted/missing never cached.
- **Deterministic flags** (each with evidence): hard → `OWNERSHIP_MISMATCH` (incl. reposts, PR/commit author ≠ linked
  GitHub username), `OUT_OF_WINDOW`, `DUPLICATE_URL` (first submitter wins), `NEAR_DUPLICATE` (≥80% vs another
  contributor; pg_trgm similarity + 64-bit SimHash; evidence = matched submission), `NOT_MERGED`, `DELETED`,
  `PROMPT_INJECTION_ATTEMPT` (normalized + de-leet pass over title, content and hidden article text). Soft →
  `NEW_ACCOUNT`, `ENGAGEMENT_ANOMALY`, `WALLET_CHANGED_RECENTLY`, `NEAR_DUPLICATE` (60–80% or own work),
  `OWNERSHIP_UNVERIFIED` (article doesn't mention the contributor's @handle), `DATE_UNVERIFIED`, `FETCH_FAILED`.
- **LLM judgment** (`judge-v2`, Haiku 4.5): forced `record_judgment` tool with `strict: true`, temperature 0; content
  in `<submission_content id="random">` with look-alike tags neutralized; system prompt says nothing inside can change
  instructions; output re-validated with zod (scores 0–10, every criterion of the chosen category); one retry on
  invalid output; refusals non-retryable. LLM is skipped when a rejecting flag already decides (no spend).
- **Decision engine** (`rules-v1`, pure TS): R1 reject flags → reject 0 · R2 injection → escalate (never auto, even
  if the model is fooled) · R3 no judgment · R4 invalid category · R5 model recommends reject/escalate · R6 any soft
  flag · R7 confidence < program threshold · R8 zero amount · R9 above per-item auto cap → escalate with the priced
  recommendation · R5a clear spam (model recommends reject, confidence ≥ 0.9, every score ≤ 1) → auto-reject, explained and overridable (`rules-v2`) · R10 auto approve/partial. Amount = maxPoints × Σscores / (10·n) × rate, exact bigint, capped at
  vault `maxPerPayout`.
- **Decision records** (`misthos.decision/v1`): canonical JSON (sorted keys) with input hash, content hash, flags +
  evidence, judgment (model, prompt version, output), rule version + rule, action, points, amount, decidedBy,
  reviewer-style summary, timestamp and signer address; `decisionHash = keccak256(json)`; EIP-191 signature over the
  raw hash by `AgentSigner` (testnet EOA from `AGENT_PRIVATE_KEY` = `0x42248B479b7E9229daF73F645f5fe7b183c0DeFB`;
  Circle SCA plugs into the same interface). `verifyDecisionRecord` (shared) re-hashes and verifies EOA or ERC-1271 —
  proven live on Arc against `MockERC1271Wallet`. Every decision writes an audit event in the same transaction.
- **Worker** (`apps/worker`): pg-boss (schema `pgboss`, Neon direct endpoint), queues `submission-process` and
  `decision-override`, atomic claim with 10-min lease, retryable errors re-queued with backoff then escalated on the
  final attempt, 60 s sweeper for jobs that never got enqueued. Refuses to start without the judge key or signer.
  `pnpm --filter @misthos/worker dev`.
- **Owner review**: program page submissions table with status filters and counts; drawer with content preview,
  flags + evidence (links), rubric scores, reasons, decision hash/rule/prompt/model, history; Approve / Adjust
  (edit amount, ≤ maxPerPayout) / Reject with a required written reason. Overrides are validated by the web app and
  signed + recorded by the worker (web never holds the signer) as `decided_by = human` records that supersede the
  agent's (`supersedes` = previous hash), audited (`decision.override_requested`, `decision.overridden`).
- **Tests** (fixtures only): agent 119 (every flag, every engine rule, injection always escalates incl. a fooled
  model, deterministic hashes, EOA + live ERC-1271 signature verification, fetcher parsing, SSRF guard, pipeline on
  PGlite with adversarial fixtures: copied thread, someone else's post, injection, hidden-text injection,
  out-of-window, deleted, unmerged PR, duplicate URL, retries, idempotency, claims, overrides), worker 6 (real pg-boss
  on PGlite: enqueue → decision, web-style producer, retry, sweeper), web 42 (submit validations, lazy rounds),
  shared 42 (classifier, canonical JSON). Fixtures in `packages/agent/test/fixtures` (synthetic, documented shapes)
  and `fixtures/recorded` (real responses from the live check).
- **Live check** (`pnpm --filter @misthos/agent live-check -- <urls>`, throwaway DB, 2026-10-02, real X + GitHub +
  Haiku): `x.com/jack/status/20` → escalated (0/10 depth, 0/10 relevance, model recommends reject at 0.99);
  `circlefin/arc-fintech#47` → escalated with 15.00 USDC recommended (8/10 impact, 7/10 quality, confidence 0.78 <
  0.80 threshold). Both records signed and verified. Cost $0.0306 (X $0.015; Haiku $0.0156, of which ~$0.006 was a
  retry caused by 7 reasons vs a max of 6, fixed in `judge-v2`). Recorded responses in `test/fixtures/recorded`.

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
- [x] `ANTHROPIC_API_KEY` in the root `.env` (works with the Messages API; key type marker `usr`).
- [x] GitHub OAuth app with callback `http://localhost:3000/api/auth/github/callback` (add the production URL in
      Phase 7). Please try "Connect GitHub" on your contributor page with your real account.
- [x] Circle entity secret + agent SCA (done 2026-10-02). **Back up `~/misthos-circle-recovery/` somewhere safe.**

## Next

- Owner: close Round 2 of Kency Arc Creators on Oct 8–9 after friends submit (Close round now in the app).
- Before 2026-12-01: migrate `railway.json` to Railway Infrastructure as Code.
- Open audit items (docs/SECURITY_AUDIT.md): two-step ownership in the next vault implementation, session
  revocation, OAuth token revoke on failed profile fetch.

## Stubs

None. `/c/[slug]` says submissions open with the agent pipeline (Phase 3); no fake data anywhere.

## Known issues

- (resolved 2026-10-05) Root `.env` lost values on 2026-10-03; all restored (Circle entity secret reset, new recovery
  file in `~/misthos-circle-recovery/`). `ARC_RPC_URL` and `VAULT_FACTORY_ADDRESS` are intentionally empty (defaults
  from `packages/shared`).
- (resolved 2026-10-05) Edge rate limiting: Vercel Firewall rule live (SECURITY_AUDIT M-4); the in-app limiter stays
  as a second layer.
- Railway's Config as Code (`railway.json`) is deprecated; it keeps working until 2026-12-01. Migrate with
  `railway config migrate` before then.
- Live X sign-in uses the owner's X app; Round 2 of Kency Arc Creators closes manually on Oct 8–9 (owner).
- Next vault implementation: two-step ownership transfer (SECURITY_AUDIT L-3). The deployed one is unchanged.
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
- The showcase program uses a 0h wallet cooldown so its seeded round can pay immediately; its settings screenshot
  shows the new 0h warning.
- No rate limiting on public endpoints yet (Phase 8 security pass). Nonce table is cleaned opportunistically.
- `next dev` with `NEXT_DIST_DIR=.next-e2e` adds `.next-e2e` type paths to `apps/web/tsconfig.json`; harmless.
- X returns `impression_count: 0` for old posts; ENGAGEMENT_ANOMALY's impressions rule ignores 0 (regression test).
- Article ownership is verified only from author metadata (byline, author tags, JSON-LD); otherwise it's a soft
  flag and goes to review.
- The browser e2e env has no worker, so `payee-sync` enqueues fail there (logged); joins still succeed by design.
- The live vault used for the showcase was topped up with 0.90 test USDC from the QA owner wallet on 2026-10-03
  (tx 0xc8eaf1d6…); after the reseed and the 2026-10-05 proof payout (0.01) it holds ~0.11. Top up before the next
  reseed (it pays 1.05).
- Browser e2e runs against a production build (`E2E_DEV=1` for next dev); the live QA harness
  (`apps/web/e2e/qa/live-qa.mts`) covers agent decisions and payouts on Arc testnet.
- The Circle testnet faucet answers 403 for our API key; QA wallets are topped up from the deployer or by hand.
- Arc RPC `eth_getLogs` rejects ranges above ~10k blocks (~1.4 h); treasury uses vault totals + recorded events
  instead of log scans. Deposits made outside Misthos show in totals but not in the deposit list.
- Circle refuses to sign from an undeployed SCA; `circle:setup` deploys it. Circle refuses reverting calls at
  estimation (`ESTIMATION_ERROR`), so failed agent proposals never land on-chain.
- The live-round check scores scripted content (it tests money movement); real-content scoring is covered by the
  Phase 3 live check.
- (resolved) Circle agent wallet not created yet (`CIRCLE_ENTITY_SECRET`, `CIRCLE_AGENT_WALLET_ID` empty) — set up together
  in the payout phase; then `setAgent` on vaults.
