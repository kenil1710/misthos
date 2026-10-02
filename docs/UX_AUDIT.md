# Misthos UX audit (Phase 6.5)

Walkthrough of every flow as a first-time user, judged against Nielsen's heuristics (visibility of system status,
match with the real world, user control, consistency, error prevention, recognition over recall, flexibility,
minimal design, error recovery, help), plus accessibility and the design direction (calm fintech).

Screenshots: `docs/screenshots/redesign/before/` (state before this pass) and `docs/screenshots/redesign/after/`.

Severity: **critical** = blocks or endangers a core task (money, trust); **major** = causes confusion, errors or
dead ends on a main path; **minor** = polish, consistency, or rare paths.

Status is filled in after the redesign: **fixed**, **partly fixed** (what remains is noted), or **open**.

## Summary

| Severity | Found | Fixed |
| --- | --- | --- |
| Critical | 6 | see table |
| Major | 22 | see table |
| Minor | 17 | see table |

## Owner flow

| # | Screen | Problem | Heuristic | Severity | Before | Proposed fix | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| O1 | Landing → sign in | `/app` signed-out view is a bare left-aligned block inside the app frame. ConnectKit's grey "Connect Wallet" pill appears, then a second "Sign in with this wallet" button appears after connecting, with no explanation of the two steps or that no transaction is sent. | Visibility, help | major | `app-overview-*` (signed out not captured) | Centered sign-in card: what Misthos is, two numbered steps (connect, sign), "free signature, no transaction", our own button styling for connect. | |
| O2 | All owner pages | Navigation is a top bar (Overview, New program, Metrics) plus a second tab row inside a program. No program switcher; the current program's name is only visible on its Overview tab; deep pages (round detail, contributor detail) have no way back except the tab row. | Visibility, consistency | major | `settings-light.png`, `rounds-light.png` | Left sidebar: program switcher at the top, program sections below, account at the bottom. Breadcrumbs on nested pages. Mobile: top bar with a menu sheet. | |
| O3 | All owner pages | Page headers are built ad hoc: Settings is titled "Vault limits", Treasury writes its own header, Rounds puts "Close round now" under the description, Program overview has a custom header. Primary actions sit in different places. | Consistency | major | `settings-light.png`, `rounds-light.png`, `treasury-light.png` | One `PageHeader` (breadcrumb, title, one-line description, primary action on the right) on every page. | |
| O4 | Overview (first run) | A new owner sees an empty state with "Create a program" but nothing about the path to a first payout (create, deploy vault, fund, publish, share, first submission, first payout). | Visibility, help | critical | `app-overview-light.png` | "Get your program live" checklist with progress on the program overview, and the next step surfaced on the owner overview. | |
| O5 | Program overview | Deploy, Fund and Publish are three separate boxes that appear and disappear based on state; Publish is a lone button in the header; the join link says "Publish to open the join page" without saying how. | Visibility, recognition | critical | `program-overview-light.png` | Checklist steps own these actions inline: each step shows done / current / locked, with its one action. | |
| O6 | Wizard | Validation only runs on Continue; errors appear all at once. "URL name" is jargon. | Error prevention | major | `new-program-light.png` | Validate on blur per field; rename to "Join link" with a live preview of the full URL; keep the step validation. | |
| O7 | Wizard, step 3 | Vault limit fields have no explanation of what each cap protects against; "Largest item paid without review" and "Minimum agent confidence" are unclear. | Help, match real world | major | `new-program-light.png` | Plain-language helper text under every limit (what it protects against), units always visible, "what's this?" link to the Guardrails doc. | |
| O8 | Wizard, review | Round start uses the browser locale format, inconsistent with UTC everywhere else. Limits show bare numbers without USDC. | Consistency | minor | — | UTC formatting and USDC units in the review step. | |
| O9 | Deploy vault | One click opens the wallet with no summary of what is being created (owner, agent, limits). The agent address is shown truncated with no explanation of what the agent can do. | Error prevention | major | `program-overview-light.png` | Confirmation dialog: "You're creating a vault owned by 0x…; the agent 0x… can only…; limits: …" then the wallet prompt. | |
| O10 | Fund vault | No confirmation of the exact amount; a value above the wallet balance silently disables the button. No faucet link on testnet. | Error prevention, recovery | critical | `treasury-light.png` | Inline "You have X USDC" with an error when the amount is too high and a faucet link on testnet; confirm dialog showing the amount, the vault and the two wallet steps (approve, deposit). | |
| O11 | All on-chain actions | Progress is a single grey status line. No explorer link while pending, no success confirmation (the page just refreshes), contract reverts come back as raw text (e.g. "PayoutTooLarge" or viem errors). | Visibility, error recovery | critical | `settings-light.png` | Shared transaction flow: steps list (waiting for wallet → pending with explorer link → confirmed / failed with a human reason and Retry), toasts for success and failure, revert names translated to sentences. | |
| O12 | Treasury / Settings | No way to withdraw funds or pause the vault in the UI, although the landing page and docs promise "pause and withdraw at any time". | Match real world, user control | critical | `treasury-light.png` | Vault controls on Treasury: Withdraw (amount, recipient, confirmation), Pause / Resume (confirmation). | |
| O13 | Wallet states | Wrong wallet, wrong network and disconnected wallet are only reported after clicking an action. | Visibility, error prevention | major | `settings-light.png` | Persistent wallet status in the shell and inline on every on-chain card, each with a one-click fix (Connect, Switch network, Switch account hint). | |
| O14 | Expired session | API calls return 401 and the UI shows "Sign-in failed" or a generic error; there is no way back except reloading. | Error recovery | major | — | Recognize 401 everywhere: "Your session expired" with a "Sign in again" button; pages re-render the sign-in card. | |
| O15 | Paused vault | Nothing in the app shows that a vault is paused, except "· paused" in small text on Treasury. Rounds will fail to execute. | Visibility | major | `treasury-light.png` | Paused banner across program pages with "Resume" for the owner. | |
| O16 | Submissions | Status filter counts are fine, but "Escalated" is internal jargon and the table has no hint of what to do. | Match real world | minor | `submissions-light.png` | "Needs review" label everywhere for escalated; tooltip explaining why items land there. | |
| O17 | Review drawer | Flag evidence is shown as raw keys (`snippet`, `patterns`, `inHiddenText false`), rule/prompt versions as bare mono tokens, "Points · confidence 2.50 · 93%". | Match real world | major | `review-drawer-light.png` | Humanized evidence labels, hide false/empty values, "Points 2.50 of 10" and "Confidence 93%" on separate rows, versions under a "Details" disclosure with tooltips. | |
| O18 | Review drawer | Override actions don't confirm the amount being approved when it differs from the agent's recommendation. | Error prevention | minor | `review-drawer-light.png` | Show "You're approving 0.40 USDC (agent recommended 0.12)" before submit. | |
| O19 | Rounds | "Close round now" closes and pays without confirmation; no explanation of what happens after (re-check, propose, auto-execute or wait for approval). | Error prevention | major | `rounds-light.png` | Confirmation dialog listing what will happen and the approved total; button moves to the page header. | |
| O20 | Round detail | Approve round shows no amount or recipients before the wallet prompt. | Error prevention | critical | `round-detail-light.png` | Confirmation dialog with the total, payout count and recipients. | |
| O21 | Contributors | Wallet-change risk is a sentence; no visual status per contributor for "in cooldown until". | Visibility | minor | `contributors-light.png` | Status badges: In vault / Not in vault yet / Cooldown until … | |
| O22 | Treasury | Deposits and payouts are unlabelled lists without column headers; the daily-cap meter has no explanation. | Recognition | minor | `treasury-light.png` | Tables with headers; one-line explanation under the meter. | |
| O23 | Settings | Only vault limits; no program information, status or agent; limit fields lack explanations. | Help | major | `settings-light.png` | Sections: Program (status, join link, publish/pause joining), Vault (address, agent, paused), Limits with helper text. | |
| O24 | Audit log | Export buttons don't say what's included; long details wrap unevenly. | Help | minor | `audit-log-light.png` | Helper text on export; consistent detail layout. | |
| O25 | Jargon | "Vault", "decision hash", "cooldown", "escalated", "agent", "round" are used without explanation. | Help, match real world | major | various | `Term` component: dotted underline with a one-line tooltip and a "Learn more" link to the docs. | |
| O26 | Loading / errors | Most owner pages have skeletons through `loading.tsx`, but client-side actions (close round, publish) have no pending feedback beyond a disabled button. | Visibility | minor | — | Buttons show spinners; toasts confirm results. | |
| O27 | Theme / buttons | ConnectKit's default button has its own radius, height and grey fill, unlike every other control. | Consistency | major | `settings-light.png` | Render the connect button with our `Button` through `ConnectKitButton.Custom`. | |

## Contributor flow

| # | Screen | Problem | Heuristic | Severity | Before | Proposed fix | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| C1 | Contributor home (375px) | The page overflows horizontally on mobile: stats and cards are cut off on the right; "X post" wraps letter-stacked next to the badge. | Accessibility, aesthetics | critical | `mobile-contributor-home-dark.png` | Fix overflow (min-w-0 / truncation on long URLs), single-column mobile layout. | |
| C2 | Join page | The X button and the wallet step look like different products (green full-width button vs grey ConnectKit pill). The step list says "two steps" but the wallet step also asks for an optional GitHub username first. | Consistency | major | `join-light.png` | A visible 3-state stepper (Sign in with X → Link wallet → Done) with the current step highlighted; GitHub moved to after the wallet as optional. | |
| C3 | Submit | After submitting, the link just appears as "Queued for review." Nothing says what happens next or when they'll be paid. | Visibility | major | `contributor-home-dark.png` | Success toast + "What happens next" panel: agent review (~1 min) → decision with reasons → paid when round N closes on date. | |
| C4 | Rejected submissions | The reason says what failed but not how to do better next time. | Error recovery | major | `contributor-home-dark.png` | Per-flag guidance ("Submit only posts from @you", "Submit work published after round start", …). | |
| C5 | Submission list | "Decision 0x…" is meaningless to contributors. | Match real world | minor | `contributor-home-dark.png` | "Verify this decision" link to the public page; hash in a tooltip. | |
| C6 | Change wallet | The cooldown length isn't stated; the change form sits next to the account card at the same weight as everything else. | Help | major | `contributor-home-dark.png` | State "Payouts to a new wallet start 24 hours after the change"; move the change form behind a "Change wallet" button. | |
| C7 | Totals | Three equal stat cards; "Approved, paid next round" doesn't say when the round closes. | Visibility | minor | `contributor-home-dark.png` | Show next payout date; on mobile stack as a compact summary. | |
| C8 | Wallet errors | Wrong network isn't relevant for signing, but a rejected signature shows a single line with no retry affordance. | Error recovery | minor | — | Inline error with "Try again". | |
| C9 | Expired session | A contributor whose session expired gets "Couldn't submit that link." | Error recovery | major | — | Recognize 401: "Your session expired. Sign in with X again" with the button. | |

## Public flow

| # | Screen | Problem | Heuristic | Severity | Before | Proposed fix | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P1 | Audit page, Verify | The decision record textarea is ~1,000px tall and dominates the section; the result panel stretches to match. | Minimal design | major | `public-verify-light.png` | Record collapsed to ~14 lines with "Show full record"; result panel sized to content. | |
| P2 | Audit page | "Verify" links in the payouts table say "Verify 1 / Verify 2" with no hint of what they verify. | Recognition | minor | `public-verify-light.png` | Tooltip "Check this decision record against Arc". | |
| P3 | Round receipt | Fine. Hashes and amounts readable; minor alignment of the header row. | — | minor | `public-round-receipt-light.png` | Use the shared PageHeader. | |
| P4 | Landing / docs | Docs search is disabled; the docs sidebar has no link back to the app. | Navigation | minor | — | Header link to the app in docs nav. | |

## Cross-cutting

| # | Problem | Severity | Proposed fix | Status |
| --- | --- | --- | --- | --- |
| X1 | No toast system: success is silent, failures are inline only. | major | Sonner toasts themed to the design system. | |
| X2 | No confirmation dialogs anywhere money moves. | critical (see O10, O20) | `ConfirmDialog` with exact amounts. | |
| X3 | Mixed card styles (`rounded-lg border p-4`, `Stat`, ad hoc boxes) and inconsistent section spacing. | minor | Use `Card`/`Stat`/`Section` from the kit everywhere touched. | |
| X4 | Mobile owner app: nav row scrolls horizontally with 7 tabs plus 3 top links. | major | Sidebar becomes a sheet on mobile. | |
| X5 | Focus rings and keyboard: drawers and dialogs trap focus correctly (Radix); custom links lack visible focus styles in a few places. | minor | Shared focus-visible ring on links. | |
