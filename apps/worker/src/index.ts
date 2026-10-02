import { startWorker } from "./start";

startWorker().catch((e) => {
  console.error("worker failed to start:", (e as Error).message);
  process.exit(1);
});
