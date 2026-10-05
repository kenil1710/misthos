# Navigation map

How people move around Misthos: where each page sits, how to get back, and where sign-in and sign-out lead.
Every rule below is covered by `apps/web/e2e/navigation.spec.ts` (plus the flows in `home`, `owner-ux` and
`owner-and-join`).

## Areas

| Area            | Routes                                                                     | Who                     | Logo goes to |
| --------------- | -------------------------------------------------------------------------- | ----------------------- | ------------ |
| Public site     | `/`, `/docs/**`, `/join/[slug]`, `/p/[slug]`, `/p/[slug]/rounds/[roundId]` | Everyone                | `/`          |
| Contributor app | `/c`, `/c/[slug]`                                                          | Signed in with X        | `/`          |
| Owner app       | `/app`, `/app/programs/**`, `/app/admin/metrics`                           | Signed in with a wallet | `/app`       |

The owner app's rail (and the mobile menu) also has **Back to site** (`/`) and **Docs**. Guided flows (the new
program wizard, "Your program is ready" and the vault setup) are full screen: no rail, a header with the logo
(→ `/app`), the flow's progress and one way out ("Save and exit", "Go to overview" or "Finish later"). `/app` is the app home:
the list of your programs, or that program directly when you own exactly one, or the welcome screen when you
own none.

## Page tree and the way back

```
/                                   landing ── header: Docs, Sign in / Start a program, or Open app when signed in
├─ /docs/**                         Fumadocs sidebar + breadcrumb; header: Open app
├─ /join/[slug]                     join steps (Sign in with X → payout wallet)
├─ /p/[slug]                        public audit; #verify is the verification tool on the same page
│  └─ /p/[slug]/rounds/[roundId]    round receipt ── "← <program> audit page"
├─ /c                               programs you joined
│  └─ /c/[slug]                     your contributions ── "← Programs you joined"
└─ /app                             your programs (or welcome)
   ├─ /app/programs/new             wizard, full screen, ?step=1..4 ── "Save and exit" (→ /app, draft kept); in-page Back
   │  └─ Create program → /app/programs/[id]/ready
   └─ /app/programs/[id]            overview (rail: Overview, Submissions, Contributors, Rounds, Treasury, Audit, Settings)
      ├─ ready                      "Your program is ready", full screen ── "Set up the vault" → setup; "Go to overview"
      ├─ setup                      guided deploy → fund → publish → "You're live", full screen; the step follows the
      │                             program's real state ── "Finish later" (→ overview); overview's setup track links here
      ├─ submissions                list / ?view=board; a row opens the review drawer
      ├─ contributors               ── breadcrumb
      │  └─ [contributorId]         ── breadcrumb (Program › Contributors › @handle)
      ├─ rounds                     ── breadcrumb
      │  └─ [roundId]               ── breadcrumb (Program › Rounds › Round N)
      ├─ treasury, audit            ── breadcrumb
      └─ settings                   ── breadcrumb; section links #join, #schedule, #vault, #limits
```

The current rail item is highlighted (`aria-current="page"`); every page has its own tab title (`<page> ·
Misthos`, with the program name on program-level pages).

## The browser Back button

- **Drawers, dialogs, the mobile menu:** opening one adds a history entry for the same URL, so Back closes it and
  stays on the page. Closing it with X, Escape or a button gives that entry back, so the next Back leaves the
  page. A link inside an open menu or drawer closes it first and then navigates, so history stays
  `previous page → new page` (no stray entries, no loops). Built into the shared `Dialog`/`Sheet`
  (`src/lib/use-back-to-close.ts`); opt out with `history={false}`.
- **Wizard:** each step is a history entry (`?step=n`); Back and Forward move between steps and keep everything
  typed (the draft is also saved on the device). A link straight to a later step only opens once the earlier steps
  are valid.
- **Filters and views** (`?status=`, `?view=board`) are links, so Back returns to the previous filter.
- Redirects (`/app` → your only program, `/c/[slug]` → join page) replace history instead of adding to it, so Back
  never bounces.
- **Guided setup:** a confirmed transaction refreshes the page in place (no new history entry), so the flow moves to
  the next step and Back still returns to where you came from (the ready screen or the overview).

## Sign-in and sign-out

| Situation                                          | What happens                                                                                                    |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Owner opens any `/app/**` page signed out          | Sign-in shows in place on that URL; after signing, the same page renders.                                       |
| Owner clicks Sign in / Start a program on the site | `/app` → sign-in → app home.                                                                                    |
| Contributor joins                                  | `/join/[slug]` → X → back to `/join/[slug]` for the wallet step → `/c/[slug]`.                                  |
| Contributor opens `/c/[slug]` signed out           | `/join/[slug]?return=dashboard`; its Sign in with X returns to `/c/[slug]` (non-members are sent back to join). |
| Contributor opens `/c` signed out                  | Sign in with X → back to `/c`.                                                                                  |
| Connect GitHub                                     | `/api/auth/github/start?next=/c/[slug]` → GitHub → back to `/c/[slug]` (errors as `?github_error=`).            |
| X or GitHub cancelled / failed                     | Back to the same `next` page with `?x_error=` / `?github_error=` explained inline.                              |
| Sign out (owner or contributor)                    | Session ends, then a full load of `/` with "You're signed out." The app then shows sign-in again.               |

`next` is always a same-origin path: `safeNextPath` rejects absolute URLs, `//host`, backslashes and control
characters (unit-tested in `test/x-oauth.test.ts`), and the value travels inside the signed OAuth flow cookie.

## Access pages

- **Contributor on the owner app** (`/app` with only an X session): owner sign-in plus "You're signed in with X
  as @handle … Go to the programs you joined".
- **Owner on someone else's program** (or a wrong id): "You don't have access to this program" with links to their
  programs, all programs and joined programs. It never reveals whether the program exists.
- **Draft program's public pages:** the owner sees a preview, everyone else a helpful 404.
- Unknown URLs: the 404 page with links home, to the app and to docs.
