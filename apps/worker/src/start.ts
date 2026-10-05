import Anthropic from "@anthropic-ai/sdk";
import {
  createJudge,
  eoaExecutor,
  eoaSigner,
  fetchArticle,
  fetchGithubCommit,
  fetchGithubPr,
  fetchXPost,
  viemVaultReader,
  type AgentExecutor,
  type AgentSigner,
  type Fetchers,
  type RoundDeps,
} from "@misthos/agent";
import { createDb, normalizeDatabaseUrl } from "@misthos/db";
import { getChainConfig, QUEUE_SCHEMA } from "@misthos/shared";
import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { PgBoss } from "pg-boss";
import pino from "pino";
import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { circleClient, circleExecutor, circleSigner } from "./circle";
import { agentBackend, directUrl, loadEnv } from "./config";
import { createRunner, runnerIsHealthy } from "./runner";

export interface StartOptions {
  /** QA only: wrap the real fetchers (e.g. to serve reserved fixture links). Production passes nothing. */
  wrapFetchers?: (real: Fetchers) => Fetchers;
  name?: string;
}

/** The real dependencies: Circle or EOA agent, Claude judge, Postgres, Arc. Shared by the worker and ops scripts. */
export function buildDeps(opts: Pick<StartOptions, "wrapFetchers"> & { poolMax?: number } = {}) {
  const env = loadEnv();
  const chain = getChainConfig(env.NEXT_PUBLIC_CHAIN);
  const { db, pool } = createDb(env.DATABASE_URL, {
    max: opts.poolMax ?? env.WORKER_CONCURRENCY + 1,
  });
  const publicClient = createPublicClient({
    chain: chain.chain,
    transport: http(env.ARC_RPC_URL || undefined),
  }) as PublicClient;
  const backend = agentBackend(env);
  let signer: AgentSigner;
  let executor: AgentExecutor;
  if (backend === "circle") {
    const circle = circleClient(env.CIRCLE_API_KEY!, env.CIRCLE_ENTITY_SECRET!);
    const address = env.CIRCLE_AGENT_WALLET_ADDRESS as Address;
    signer = circleSigner(circle, env.CIRCLE_AGENT_WALLET_ID!, address);
    executor = circleExecutor(circle, env.CIRCLE_AGENT_WALLET_ID!, address);
  } else {
    const account = privateKeyToAccount(env.AGENT_PRIVATE_KEY as Hex);
    signer = eoaSigner(env.AGENT_PRIVATE_KEY as Hex);
    executor = eoaExecutor(
      createWalletClient({
        chain: chain.chain,
        transport: http(env.ARC_RPC_URL || undefined),
        account,
      }),
      publicClient,
    );
  }
  const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 2 });
  const real: Fetchers = {
    x: (id, o) => fetchXPost(id, { bearerToken: env.X_BEARER_TOKEN, thread: o?.thread }),
    githubPr: (rid) => fetchGithubPr(rid, { token: env.GITHUB_TOKEN }),
    githubCommit: (rid) => fetchGithubCommit(rid, { token: env.GITHUB_TOKEN }),
    article: (rid) => fetchArticle(rid),
  };
  const realFetchers = opts.wrapFetchers ? opts.wrapFetchers(real) : real;

  const deps: RoundDeps = {
    db,
    reader: viemVaultReader(publicClient),
    executor,
    chainId: chain.chain.id,
    signer,
    judge: createJudge({ client: anthropic.messages, model: env.AGENT_MODEL_JUDGE }),
    fetchers: realFetchers,
  };
  return { env, chain, deps, pool, signer };
}

/**
 * Build the real dependencies and run the queues in drains (see runner.ts): at startup, every WORKER_TICK_MINUTES,
 * for scheduled retries, and when the web app calls POST /wake after enqueueing work. GET /health answers from
 * memory, so monitoring never wakes the database.
 */
export async function startWorker(opts: StartOptions = {}) {
  // Level names ("info", "error") instead of numbers, so hosted log viewers (Railway) show and filter them.
  const log = pino({
    name: opts.name ?? "misthos-worker",
    formatters: { level: (label) => ({ level: label }) },
  });
  const { env, chain, deps, pool, signer } = buildDeps(opts);
  const runner = createRunner({
    // pg-boss without its own timers: it only runs inside a drain, then stops and closes its connections.
    makeBoss: () =>
      new PgBoss({
        connectionString: normalizeDatabaseUrl(directUrl(env)),
        schema: QUEUE_SCHEMA,
        supervise: false,
        schedule: false,
        max: 2,
      }),
    deps,
    log,
    opts: { concurrency: env.WORKER_CONCURRENCY },
    tickMinutes: env.WORKER_TICK_MINUTES,
  });

  const secret = env.WORKER_WAKE_SECRET ? Buffer.from(env.WORKER_WAKE_SECRET) : null;
  const authorized = (header: string | undefined) => {
    if (!secret || !header?.startsWith("Bearer ")) return false;
    const given = Buffer.from(header.slice(7));
    return given.length === secret.length && timingSafeEqual(given, secret);
  };
  const server = createServer((req, res) => {
    const send = (status: number, body: object) => {
      res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "GET" && req.url === "/health") {
      // Public: the verdict and timestamps only. Error text stays in the logs (N-13).
      const h = runner.health();
      const verdict = runnerIsHealthy(h);
      return send(verdict.ok ? 200 : 503, {
        ...verdict,
        lastTickAt: h.lastTickAt,
        lastDrainAt: h.lastDrainAt,
        draining: h.draining,
        tickMinutes: h.tickMinutes,
      });
    }
    if (req.method === "POST" && req.url === "/wake") {
      if (!authorized(req.headers.authorization)) return send(401, { ok: false });
      void runner.drain("wake");
      return send(202, { ok: true });
    }
    send(404, { ok: false });
  });
  server.listen(env.PORT, () => log.info({ port: env.PORT }, "worker http listening"));
  runner.start();
  log.info(
    {
      chain: chain.key,
      signer: signer.address,
      model: env.AGENT_MODEL_JUDGE,
      tickMinutes: env.WORKER_TICK_MINUTES,
      wake: !!secret,
    },
    "worker ready",
  );

  const shutdown = async (signal: string) => {
    log.info({ signal }, "shutting down");
    server.close();
    await runner.stop();
    await pool.end();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}
