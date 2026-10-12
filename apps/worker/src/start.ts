import Anthropic from "@anthropic-ai/sdk";
import {
  createJudge,
  createUnderstander,
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
import { agentBackend, directUrl, loadEnv, mainnetAgent } from "./config";
import type { WorkerDeps } from "./jobs";
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

  const base: RoundDeps = {
    db,
    reader: viemVaultReader(publicClient),
    executor,
    chainId: chain.chain.id,
    signer,
    judge: createJudge({ client: anthropic.messages, model: env.AGENT_MODEL_JUDGE }),
    understand: createUnderstander({ client: anthropic.messages, model: env.AGENT_MODEL_JUDGE }),
    fetchers: realFetchers,
  };

  // One set of chain dependencies per network. Arc Testnet (the primary network) is `base`; Arc Mainnet is added only
  // when its own Circle agent is fully configured (LIVE key, wallet id, address), never from the testnet key.
  const byChain = new Map<string, RoundDeps>([[chain.key, base]]);
  const main = mainnetAgent(env);
  if (main.agent) {
    const mainnet = getChainConfig("arc-mainnet");
    const client = createPublicClient({
      chain: mainnet.chain,
      transport: http(main.agent.rpcUrl),
    }) as PublicClient;
    const circle = circleClient(main.agent.apiKey, main.agent.entitySecret);
    byChain.set("arc-mainnet", {
      ...base,
      reader: viemVaultReader(client),
      executor: circleExecutor(circle, main.agent.walletId, main.agent.address),
      signer: circleSigner(circle, main.agent.walletId, main.agent.address),
      chainId: mainnet.chain.id,
    });
  }
  const deps: WorkerDeps = {
    ...base,
    networks: [...byChain.keys()],
    // A program on a network this worker has no agent for gets null: its jobs are skipped (logged), never run on
    // another network's agent.
    forChain: (key) => byChain.get(key) ?? null,
  };
  const disabled = main.agent ? null : `Arc Mainnet off: ${main.reason}`;
  return { env, chain, deps, pool, signer, networks: [...byChain.keys()], disabled };
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
  const { env, chain, deps, pool, signer, networks, disabled } = buildDeps(opts);
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
      networks,
      signer: signer.address,
      model: env.AGENT_MODEL_JUDGE,
      tickMinutes: env.WORKER_TICK_MINUTES,
      wake: !!secret,
    },
    "worker ready",
  );
  // Mainnet programs wait (their jobs are skipped and picked up once the agent is configured); testnet runs as usual.
  if (disabled) log.warn(`${disabled}. Mainnet programs are skipped; testnet is unaffected.`);

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
