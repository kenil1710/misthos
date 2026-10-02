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
import { registerJobs } from "./jobs";

export interface StartOptions {
  /** QA only: wrap the real fetchers (e.g. to serve reserved fixture links). Production passes nothing. */
  wrapFetchers?: (real: Fetchers) => Fetchers;
  name?: string;
}

/** Build the real dependencies (Circle or EOA agent, Claude judge, Postgres, Arc) and start consuming the queues. */
export async function startWorker(opts: StartOptions = {}) {
  const log = pino({ name: opts.name ?? "misthos-worker" });
  const env = loadEnv();
  const chain = getChainConfig(env.NEXT_PUBLIC_CHAIN);
  const { db, pool } = createDb(env.DATABASE_URL, { max: env.WORKER_CONCURRENCY + 1 });
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
    x: (id) => fetchXPost(id, { bearerToken: env.X_BEARER_TOKEN }),
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

  const boss = new PgBoss({
    connectionString: normalizeDatabaseUrl(directUrl(env)),
    schema: "pgboss",
  });
  boss.on("error", (e) => log.error({ err: e.message }, "pg-boss error"));
  await boss.start();
  const jobs = await registerJobs(boss, deps, log, { concurrency: env.WORKER_CONCURRENCY });
  log.info(
    { chain: chain.key, signer: signer.address, model: env.AGENT_MODEL_JUDGE },
    "worker ready",
  );

  const shutdown = async (signal: string) => {
    log.info({ signal }, "shutting down");
    jobs.stop();
    await boss.stop({ graceful: true, timeout: 30_000 });
    await pool.end();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}
