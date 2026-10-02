import { z } from "zod";

const Env = z.object({
  DATABASE_URL: z.string().min(1),
  /** Neon's direct (non-pooler) endpoint for pg-boss; derived from DATABASE_URL when unset. */
  DATABASE_URL_DIRECT: z.string().optional(),
  NEXT_PUBLIC_CHAIN: z.enum(["arc-testnet", "arc-mainnet"]).default("arc-testnet"),
  X_BEARER_TOKEN: z.string().min(1),
  GITHUB_TOKEN: z.string().optional(),
  ANTHROPIC_API_KEY: z
    .string()
    .min(1, "ANTHROPIC_API_KEY is required: the worker won't record decisions without its judge"),
  AGENT_MODEL_JUDGE: z.string().default("claude-haiku-4-5-20251001"),
  /** Testnet EOA: decision signer and executor fallback. */
  AGENT_PRIVATE_KEY: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/, "AGENT_PRIVATE_KEY must be a 32-byte hex key")
    .optional(),
  /** "circle" (agent SCA, Gas Station) or "eoa" (AGENT_PRIVATE_KEY). Defaults to circle when it's configured. */
  AGENT_BACKEND: z.enum(["circle", "eoa"]).optional(),
  CIRCLE_API_KEY: z.string().optional(),
  CIRCLE_ENTITY_SECRET: z.string().optional(),
  CIRCLE_AGENT_WALLET_ID: z.string().optional(),
  CIRCLE_AGENT_WALLET_ADDRESS: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/)
    .optional(),
  ARC_RPC_URL: z.string().optional(),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
});
export type WorkerEnv = z.infer<typeof Env>;

const circleReady = (e: WorkerEnv) =>
  !!(
    e.CIRCLE_API_KEY &&
    e.CIRCLE_ENTITY_SECRET &&
    e.CIRCLE_AGENT_WALLET_ID &&
    e.CIRCLE_AGENT_WALLET_ADDRESS
  );

/** Which agent backend to use, or an error naming what's missing. */
export function agentBackend(e: WorkerEnv): "circle" | "eoa" {
  const wanted = e.AGENT_BACKEND ?? (circleReady(e) ? "circle" : "eoa");
  if (wanted === "circle" && !circleReady(e))
    throw new Error(
      "AGENT_BACKEND=circle needs CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET, CIRCLE_AGENT_WALLET_ID and CIRCLE_AGENT_WALLET_ADDRESS",
    );
  if (wanted === "eoa" && !e.AGENT_PRIVATE_KEY)
    throw new Error("AGENT_BACKEND=eoa needs AGENT_PRIVATE_KEY");
  return wanted;
}

/** Validate env; report missing/invalid keys by name only, never values. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv {
  const parsed = Env.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid worker environment: ${problems}`);
  }
  return parsed.data;
}

/** Neon pooled hosts contain "-pooler"; pg-boss is happier on a direct session connection. */
export function directUrl(env: WorkerEnv): string {
  return env.DATABASE_URL_DIRECT || env.DATABASE_URL.replace(/-pooler(?=\.)/, "");
}
