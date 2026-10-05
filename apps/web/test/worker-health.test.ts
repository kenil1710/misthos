import { describe, expect, it } from "vitest";
import { workerHealth } from "@/lib/worker-health";

const now = Date.UTC(2026, 9, 5, 12);
const ago = (s: number) => new Date(now - s * 1000);

describe("workerHealth", () => {
  it("is ok when the worker was seen recently and nothing is stuck", () => {
    expect(workerHealth(ago(20), null, now)).toEqual({
      ok: true,
      problem: null,
      workerSeenSecondsAgo: 20,
      oldestQueuedSeconds: null,
    });
    expect(workerHealth(ago(20), ago(90), now).ok).toBe(true);
  });

  it("fails when the worker has gone quiet for more than 5 minutes", () => {
    expect(workerHealth(ago(6 * 60), null, now)).toMatchObject({
      ok: false,
      problem: "The worker hasn't been seen for 6 minutes.",
    });
    expect(workerHealth(null, null, now).problem).toBe("The worker has never reported in.");
  });

  it("fails when a submission has waited more than 10 minutes, even if the worker looks alive", () => {
    expect(workerHealth(ago(10), ago(11 * 60), now)).toMatchObject({
      ok: false,
      problem: "A submission has been waiting 11 minutes for the worker.",
    });
  });
});
