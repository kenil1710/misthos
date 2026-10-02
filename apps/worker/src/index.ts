import Anthropic from "@anthropic-ai/sdk";
import {
  createJudge,
  eoaSigner,
  fetchArticle,
  fetchGithubCommit,
  fetchGithubPr,
  fetchXPost,
  type PipelineDeps,
} from "@misthos/agent";
import { createDb, normalizeDatabaseUrl } from "@misthos/db";
import { getChainConfig, QUEUE_SCHEMA } from "@misthos/shared";
import { PgBoss } from "pg-boss";
import pino from "pino";
import type { Hex } from "viem";
import { directUrl, loadEnv } from "./config";
import { registerJobs } from "./jobs";

const log = pino({ name: "misthos-worker" });

async function main() {
  const env = loadEnv();
  const chain = getChainConfig(env.NEXT_PUBLIC_CHAIN);
  const { db, pool } = createDb(env.DATABASE_URL, { max: env.WORKER_CONCURRENCY + 1 });
  const signer = eoaSigner(env.AGENT_PRIVATE_KEY as Hex);
  const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 2 });

  const deps: PipelineDeps = {
    db,
    chainId: chain.chain.id,
    signer,
    judge: createJudge({ client: anthropic.messages, model: env.AGENT_MODEL_JUDGE }),
    fetchers: {
      x: (id) => fetchXPost(id, { bearerToken: env.X_BEARER_TOKEN }),
      githubPr: (rid) => fetchGithubPr(rid, { token: env.GITHUB_TOKEN }),
      githubCommit: (rid) => fetchGithubCommit(rid, { token: env.GITHUB_TOKEN }),
      article: (rid) => fetchArticle(rid),
    },
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

main().catch((e) => {
  log.fatal({ err: (e as Error).message }, "worker failed to start");
  process.exit(1);
});
