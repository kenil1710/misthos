import Anthropic from "@anthropic-ai/sdk";
import {
  CLAIM_LEASE_MS,
  createJudge,
  eoaSigner,
  fetchArticle,
  fetchGithubCommit,
  fetchGithubPr,
  fetchXPost,
  processOverride,
  processSubmission,
  type PipelineDeps,
} from "@misthos/agent";
import { createDb, normalizeDatabaseUrl, submissions } from "@misthos/db";
import { and, eq, lt, or } from "drizzle-orm";
import { getChainConfig, OverrideDecisionJob, ProcessSubmissionJob, QUEUES } from "@misthos/shared";
import { PgBoss } from "pg-boss";
import pino from "pino";
import type { Hex } from "viem";
import { directUrl, loadEnv } from "./config";

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
  const retry = { retryLimit: 4, retryDelay: 15, retryBackoff: true, expireInSeconds: 300 };
  await boss.createQueue(QUEUES.processSubmission, retry);
  await boss.createQueue(QUEUES.overrideDecision, { ...retry, retryLimit: 2 });

  await boss.work(
    QUEUES.processSubmission,
    {
      batchSize: 1,
      pollingIntervalSeconds: 1,
      includeMetadata: true,
      localConcurrency: env.WORKER_CONCURRENCY,
    },
    async ([job]) => {
      const { submissionId } = ProcessSubmissionJob.parse(job!.data);
      const finalAttempt = job!.retryCount >= job!.retryLimit;
      const started = Date.now();
      try {
        const res = await processSubmission(deps, submissionId, { finalAttempt });
        log.info({ submissionId, ...res, ms: Date.now() - started }, "submission processed");
      } catch (e) {
        log.warn(
          { submissionId, attempt: job!.retryCount, err: (e as Error).message },
          "submission will retry",
        );
        throw e;
      }
    },
  );

  await boss.work(
    QUEUES.overrideDecision,
    { batchSize: 1, pollingIntervalSeconds: 1 },
    async ([job]) => {
      const data = OverrideDecisionJob.parse(job!.data);
      const res = await processOverride(deps, data);
      log.info({ submissionId: data.submissionId, ...res }, "override processed");
    },
  );

  // Sweeper: re-enqueue submissions that never got a job (enqueue failed) or whose worker died mid-claim.
  // The pipeline's atomic claim makes duplicate jobs harmless.
  const sweep = async () => {
    const now = Date.now();
    const stuck = await db
      .select({ id: submissions.id })
      .from(submissions)
      .where(
        or(
          and(
            eq(submissions.status, "pending"),
            lt(submissions.updatedAt, new Date(now - 2 * 60_000)),
          ),
          and(
            eq(submissions.status, "processing"),
            lt(submissions.updatedAt, new Date(now - CLAIM_LEASE_MS)),
          ),
        ),
      )
      .limit(50);
    for (const { id } of stuck)
      await boss.send(QUEUES.processSubmission, { submissionId: id }, { singletonKey: id });
    if (stuck.length) log.info({ count: stuck.length }, "re-enqueued stuck submissions");
  };
  const sweeper = setInterval(
    () => void sweep().catch((e) => log.error({ err: (e as Error).message }, "sweep failed")),
    60_000,
  );

  log.info(
    { chain: chain.key, signer: signer.address, model: env.AGENT_MODEL_JUDGE },
    "worker ready",
  );

  const shutdown = async (signal: string) => {
    log.info({ signal }, "shutting down");
    clearInterval(sweeper);
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
