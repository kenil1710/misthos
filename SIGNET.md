# misthos.world is sealed with Signet

What users load from misthos.world is what Misthos's approvers sealed on X Layer. Users with Signet Guard get every
script checked against the seal, and Guard refuses any signature to a contract that isn't sealed: on Arc, only USDC,
the vault factory, and vaults the factory created **for the signing owner** (or its guardian).

- Page mode `ssr` (server-rendered): the code is sealed, not the HTML. See Signet's threat model for what that covers.
- `apps/web/signet.config.json`: the domain, the gate, the crawl list (one page per layout and a 404 inside each nested
  layout), the allowlist (USDC + factory per chain; everything else found in the bundled libraries excluded, Permit2
  included: Misthos never calls it), and the origins (documentation and store links removed).
- `apps/web/vercel.json`: pushes to `main` no longer deploy. `signet-release` builds, stages, seals and proposes; the
  release goes live (`vercel promote`) only after it is published on X Layer.

## Setup (in this order; merge the PR only after step 5)

1. **Vercel token** (vercel.com → Account Settings → Tokens → Create: scope = the team that owns the `misthos`
   project, an expiry date). Add it in your own terminal (`gh` asks for it; it never appears anywhere):
   `gh secret set VERCEL_TOKEN -R kenil1710/misthos`
2. **Vercel IDs** (not secret; the project's Root Directory is `apps/web`, so the Vercel CLI runs from the repo root,
   where `vercel link` already wrote `.vercel/project.json`): `gh variable set VERCEL_ORG_ID -R kenil1710/misthos -b <orgId>`
   and the same for `VERCEL_PROJECT_ID`.
   **Protection bypass** (the seal crawls the staged deployment, which Deployment Protection hides): Project →
   Settings → Deployment Protection → Protection Bypass for Automation → create; then
   `gh secret set VERCEL_AUTOMATION_BYPASS_SECRET -R kenil1710/misthos`.
3. **CI proposer key**: `npx signetguard@0.2.1 keygen` in `apps/web` (prints only the address), then
   `gh secret set SIGNET_PROPOSER_KEY -R kenil1710/misthos < apps/web/.signet/proposer.key`.
4. **The gate** (X Layer mainnet, approved separately): created in https://signetguard.xyz/app → New project, from
   Approver A, with approvers A, B, C, the proposer address from step 3, recovery `0x6940…6D93`, guardian signet-ops `0x9275eDEC1c4940B85a1e11Cce3EAd662ba00E291` (it can only freeze releases). Created 2026-11-24: gate `0xDfFf2307d45df1995502d8b300aE9AfbB01c4a59`.
   Then in `apps/web`: `npx signetguard@0.2.1 link misthos.world <gate>` (writes the gate into the config after checking
   the binding) and `npx signetguard@0.2.1 domain public` (writes `public/.well-known/signet.json`); commit both here.
5. Vercel → Project → Analytics, Speed Insights: off for Production; Settings → General → Vercel Toolbar: off for
   Production. Fund the CI key with 0.002 OKB on X Layer.
6. Merge. The next push runs `signet-release`. The first release is tier 10 (2 approvals + 24 h): approve in the
   dashboard, then run `signet-promote` with the run id after 24 h. Guard starts in observe mode for 7 days; switch to
   enforce after its reports and the watchtower are clean.
