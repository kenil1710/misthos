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
  AGENT_PRIVATE_KEY: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/, "AGENT_PRIVATE_KEY must be a 32-byte hex key"),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
});
export type WorkerEnv = z.infer<typeof Env>;

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
