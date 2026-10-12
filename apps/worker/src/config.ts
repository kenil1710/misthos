import { z } from "zod";

const Env = z.object({
  DATABASE_URL: z.string().min(1),
  /** Neon's direct (non-pooler) endpoint for pg-boss; derived from DATABASE_URL when unset. */
  DATABASE_URL_DIRECT: z.string().optional(),
  /**
   * The worker's primary network, served with CIRCLE_API_KEY / AGENT_PRIVATE_KEY. Always Arc Testnet: Arc Mainnet is
   * only ever served by its own agent (CIRCLE_LIVE_API_KEY), so a testnet key can never be pointed at mainnet.
   */
  NEXT_PUBLIC_CHAIN: z
    .enum(["arc-testnet", "arc-mainnet"])
    .default("arc-testnet")
    .refine(
      (c) => c === "arc-testnet",
      "the worker's primary network is arc-testnet; Arc Mainnet runs on its own agent (CIRCLE_LIVE_API_KEY)",
    ),
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
  /**
   * Arc Mainnet agent (optional). Its own Circle production key (LIVE_API_KEY:…) and agent wallet: never the testnet
   * key, never an EOA. Missing, partial or invalid values turn mainnet off (logged); they never stop the worker. The
   * entity secret defaults to CIRCLE_ENTITY_SECRET (an entity secret belongs to the Circle account).
   */
  CIRCLE_LIVE_API_KEY: z.string().optional(),
  CIRCLE_MAINNET_ENTITY_SECRET: z.string().optional(),
  CIRCLE_MAINNET_AGENT_WALLET_ID: z.string().optional(),
  CIRCLE_MAINNET_AGENT_WALLET_ADDRESS: z.string().optional(),
  ARC_MAINNET_RPC_URL: z.string().optional(),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
  /** How often the worker looks for due rounds, stuck jobs and retries (minutes). The web app wakes it for new work. */
  WORKER_TICK_MINUTES: z.coerce.number().min(1).max(120).default(15),
  /** Shared with the web app: authenticates its "new work" wake calls. Without it, /wake is disabled. */
  WORKER_WAKE_SECRET: z.string().min(32).optional(),
  /** HTTP port for /health and /wake (Railway sets PORT). */
  PORT: z.coerce.number().int().default(8080),
});
export type WorkerEnv = z.infer<typeof Env>;

const circleReady = (e: WorkerEnv) =>
  !!(
    e.CIRCLE_API_KEY &&
    e.CIRCLE_ENTITY_SECRET &&
    e.CIRCLE_AGENT_WALLET_ID &&
    e.CIRCLE_AGENT_WALLET_ADDRESS
  );

export interface MainnetAgent {
  apiKey: string;
  entitySecret: string;
  walletId: string;
  address: `0x${string}`;
  rpcUrl: string | undefined;
}

/**
 * The Arc Mainnet agent: all of the LIVE key, wallet id and address, or it's off. Never a fallback to the testnet
 * key or wallet. `reason` says why it's off (names only, never values).
 */
export function mainnetAgent(
  e: WorkerEnv,
): { agent: MainnetAgent; reason?: undefined } | { agent: null; reason: string } {
  const parts = {
    CIRCLE_LIVE_API_KEY: e.CIRCLE_LIVE_API_KEY,
    CIRCLE_MAINNET_AGENT_WALLET_ID: e.CIRCLE_MAINNET_AGENT_WALLET_ID,
    CIRCLE_MAINNET_AGENT_WALLET_ADDRESS: e.CIRCLE_MAINNET_AGENT_WALLET_ADDRESS,
  };
  if (!Object.values(parts).some(Boolean))
    return {
      agent: null,
      reason: "not configured (CIRCLE_LIVE_API_KEY and the mainnet agent wallet are unset)",
    };
  const missing = Object.entries(parts)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  const entitySecret = e.CIRCLE_MAINNET_ENTITY_SECRET || e.CIRCLE_ENTITY_SECRET;
  if (!entitySecret) missing.push("CIRCLE_MAINNET_ENTITY_SECRET (or CIRCLE_ENTITY_SECRET)");
  if (missing.length)
    return { agent: null, reason: `half-configured; missing ${missing.join(", ")}` };
  if (!e.CIRCLE_LIVE_API_KEY!.startsWith("LIVE_API_KEY:"))
    return {
      agent: null,
      reason: "CIRCLE_LIVE_API_KEY isn't a Circle production key (LIVE_API_KEY:…)",
    };
  if (!/^0x[0-9a-fA-F]{40}$/.test(e.CIRCLE_MAINNET_AGENT_WALLET_ADDRESS!))
    return { agent: null, reason: "CIRCLE_MAINNET_AGENT_WALLET_ADDRESS isn't an address" };
  if (
    e.CIRCLE_AGENT_WALLET_ADDRESS &&
    e.CIRCLE_AGENT_WALLET_ADDRESS.toLowerCase() ===
      e.CIRCLE_MAINNET_AGENT_WALLET_ADDRESS!.toLowerCase()
  )
    return { agent: null, reason: "the mainnet agent wallet is the testnet one" };
  if (e.CIRCLE_MAINNET_AGENT_WALLET_ID === e.CIRCLE_AGENT_WALLET_ID)
    return { agent: null, reason: "the mainnet agent wallet id is the testnet one" };
  return {
    agent: {
      apiKey: e.CIRCLE_LIVE_API_KEY!,
      entitySecret: entitySecret!,
      walletId: e.CIRCLE_MAINNET_AGENT_WALLET_ID!,
      address: e.CIRCLE_MAINNET_AGENT_WALLET_ADDRESS! as `0x${string}`,
      rpcUrl: e.ARC_MAINNET_RPC_URL || undefined,
    },
  };
}

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
