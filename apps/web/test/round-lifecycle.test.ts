import { describe, expect, it } from "vitest";
import { roundLifecycle, type LifecycleInput } from "@/lib/round-lifecycle";

const now = Date.parse("2026-10-03T12:00:00Z");
const base: LifecycleInput = {
  status: "open",
  scheduled: false,
  startsAt: new Date("2026-10-01T00:00:00Z"),
  endsAt: new Date("2026-10-05T16:00:00Z"),
  events: [],
  txHashPropose: null,
  txHashApprove: null,
  txHashExecute: null,
  needsApproval: false,
  nothingToPay: false,
  lastError: null,
};
const states = (r: Partial<LifecycleInput>) =>
  roundLifecycle({ ...base, ...r }, now).map((s) => `${s.key}:${s.state}`);

describe("roundLifecycle", () => {
  it("open, with a countdown", () => {
    const s = roundLifecycle(base, now);
    expect(s[0]).toMatchObject({ state: "current", meta: "closes in 2d 4h" });
    expect(s.slice(1).every((x) => x.state === "waiting")).toBe(true);
  });
  it("proposed above the threshold waits for the owner", () => {
    expect(
      states({
        status: "proposed",
        txHashPropose: "0x1",
        needsApproval: true,
        events: [{ action: "round.planned", at: new Date() }],
      }),
    ).toEqual([
      "open:done",
      "closed:done",
      "planned:done",
      "proposed:done",
      "approved:current",
      "paid:waiting",
    ]);
  });
  it("paid within the auto-approve limit skips the approval", () => {
    const s = roundLifecycle(
      { ...base, status: "executed", txHashPropose: "0x1", txHashExecute: "0x2" },
      now,
    );
    expect(s.map((x) => x.state)).toEqual(["done", "done", "done", "done", "skipped", "done"]);
    expect(s.at(-1)!.txHash).toBe("0x2");
  });
  it("nothing to pay ends after closing", () => {
    expect(states({ status: "executed", nothingToPay: true })).toEqual([
      "open:done",
      "closed:done",
      "planned:done",
      "proposed:skipped",
      "approved:skipped",
      "paid:skipped",
    ]);
  });
  it("a failure marks the step it stopped at", () => {
    const s = roundLifecycle(
      {
        ...base,
        status: "failed",
        lastError: "RPC down",
        events: [{ action: "round.planned", at: new Date() }],
      },
      now,
    );
    expect(s[3]).toMatchObject({ key: "proposed", state: "failed", detail: "RPC down" });
    expect(s.slice(4).map((x) => x.state)).toEqual(["skipped", "skipped"]);
  });
  it("scheduled rounds count down to opening", () => {
    expect(
      roundLifecycle(
        { ...base, scheduled: true, startsAt: new Date("2026-10-06T12:00:00Z") },
        now,
      )[0],
    ).toMatchObject({
      label: "Opens",
      meta: "in 3d",
    });
  });
});
