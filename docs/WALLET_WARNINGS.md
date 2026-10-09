# Wallet warnings on misthos.world

Checked 2026-10-10 for the move to https://misthos.world.

## What Misthos asks wallets for

- **Page load:** nothing that prompts. Only silent reads (`eth_accounts`, `eth_chainId`) when a wallet reconnects;
  e2e asserts this (`wallet.spec.ts`, "a wallet on another network…").
- **Connect (after a click):** `eth_requestAccounts`; if the wallet is on another chain, `wallet_switchEthereumChain`
  to Arc Testnet (5042002), and `wallet_addEthereumChain` if the wallet doesn't know it.
- **Owner sign-in:** one `personal_sign` of a standard EIP-4361 (SIWE) message. `domain` is `misthos.world` and
  `uri` is `https://misthos.world`, both taken from the page itself, so they always match the site the wallet sees.
  The server refuses any other domain or URI (`lib/server/siwe.ts`, tests in `test/canonical-host.test.ts`).
- **Contributor wallet link:** one `personal_sign` of a plain-text message naming the program, the X handle, the
  wallet and Arc Testnet. No transaction, no approval, no typed data.
- **Owner actions:** vault deploy, USDC approve + deposit, limits, pause, withdraw, approve round: each from a click,
  each shown with exact amounts first.

## Lists

- MetaMask's phishing list (`eth-phishing-detect`): `misthos.world` is **not** listed (checked 2026-10-10).
- A "Malicious" or "Deceptive request" banner on a signature or transaction comes from Blockaid's live check, which
  can flag new domains.

## Dispute: MetaMask / Blockaid (from the warning itself)

In MetaMask, on the warning: **See details → Report an issue**. It pre-fills the request. Add:

> Misthos (https://misthos.world) is a live testnet app on Arc Testnet (chain 5042002) that pays communities in USDC
> for verified work. The flagged request is a standard Sign-In with Ethereum message (EIP-4361) for misthos.world,
> with domain and URI matching the site; it moves no funds and grants no approval. The domain moved from
> misthos-iota.vercel.app (which now redirects permanently) on 2026-10-10. Source code:
> https://github.com/kenil1710/misthos. Contracts are verified on https://explorer.testnet.arc.io. Please clear the
> false positive for misthos.world.

## Dispute: MetaMask "Deceptive site ahead" (only if it ever shows)

Open an issue at https://github.com/MetaMask/eth-phishing-detect/issues (as the site owner):

> **Title:** False positive: misthos.world
>
> misthos.world is the production domain of Misthos, an open-source app on Arc Testnet that pays community
> contributors in USDC from owner-controlled vaults. It replaced misthos-iota.vercel.app on 2026-10-10 (308 redirect
> in place). It never asks for seed phrases, approvals to third parties or transfers on load; sign-in is a standard
> EIP-4361 message for misthos.world. Code: https://github.com/kenil1710/misthos. I'm the owner (GitHub kenil1710)
> and can verify control of the domain with a DNS TXT record if needed.

## Dispute: Blockaid directly

If the in-wallet report doesn't clear it, use the same text through Blockaid's dApp false-positive form, linked from
https://www.blockaid.io (support / "Report a false positive").
