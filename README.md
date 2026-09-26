# Misthos

Contributor payroll, run by an agent you can audit. Misthos verifies contributor work, catches fraud, and pays in
USDC on Arc, inside limits enforced on-chain.

> Work in progress for the Tameion Agents Hackathon. See [PROGRESS.md](./PROGRESS.md) for current status.

## Develop

```bash
pnpm install
cp .env.example .env
pnpm dev            # web on :3000, worker
pnpm test           # vitest + forge test
pnpm typecheck
```

Requires Node 22+, pnpm 12, Foundry.

## Layout

| Path                 | What                                                                       |
| -------------------- | -------------------------------------------------------------------------- |
| `apps/web`           | Next.js app: landing, owner app, contributor app, public audit pages, docs |
| `apps/worker`        | Agent pipeline and chain jobs (pg-boss)                                    |
| `packages/contracts` | `MisthosVault` + factory (Foundry)                                         |
| `packages/agent`     | Pure, tested agent logic                                                   |
| `packages/db`        | Drizzle schema and migrations                                              |
| `packages/shared`    | Chain config (cited), zod schemas, money helpers, decision hashing         |
