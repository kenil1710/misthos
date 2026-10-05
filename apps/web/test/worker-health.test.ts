import { describe, expect, it } from "vitest";
import { workerHealth } from "@/lib/worker-health";

describe("workerHealth", () => {
  it("passes the worker's own verdict through, without anything private", () => {
    expect(
      workerHealth({
        ok: true,
        problem: null,
        lastTickAt: "2026-10-05T12:00:00Z",
        lastDrainAt: "2026-10-05T12:01:00Z",
        tickMinutes: 15,
        lastError: "x",
      }),
    ).toEqual({
      ok: true,
      problem: null,
      lastTickAt: "2026-10-05T12:00:00Z",
      lastDrainAt: "2026-10-05T12:01:00Z",
      tickMinutes: 15,
    });
  });

  it("reports the worker's problem", () => {
    expect(workerHealth({ ok: false, problem: "No scheduled pass for 40 minutes." })).toMatchObject(
      {
        ok: false,
        problem: "No scheduled pass for 40 minutes.",
      },
    );
  });

  it("no answer is unhealthy", () => {
    expect(workerHealth(null)).toMatchObject({ ok: false, problem: "The worker didn't answer." });
    expect(workerHealth("<html>")).toMatchObject({ ok: false });
  });
});
