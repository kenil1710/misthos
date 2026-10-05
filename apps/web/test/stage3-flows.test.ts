import { describe, expect, it } from "vitest";
import { contributorTimeline } from "@/lib/contributor-timeline";
import { fundSuggestions, setupCurrent, setupSteps } from "@/lib/setup-flow";
import { revealDone, VERIFY_CHECKS, verifyStatuses } from "@/lib/verify-view";

describe("setup flow (deploy → fund → publish)", () => {
  it("starts at deploy and walks the steps in order", () => {
    const none = { vaultDeployed: false, funded: false, published: false };
    expect(setupCurrent(none)).toBe("deploy");
    expect(setupSteps(none).map((s) => s.status)).toEqual(["current", "waiting", "waiting"]);
    expect(setupCurrent({ ...none, vaultDeployed: true })).toBe("fund");
    expect(setupCurrent({ vaultDeployed: true, funded: true, published: false })).toBe("publish");
    expect(setupCurrent({ vaultDeployed: true, funded: true, published: true })).toBe("live");
  });
  it("keeps a step done even when an earlier one is the next to do", () => {
    // Published early (allowed from the overview), vault not funded yet.
    const s = setupSteps({ vaultDeployed: true, funded: false, published: true });
    expect(s.map((x) => x.status)).toEqual(["done", "current", "done"]);
  });
  it("suggests one and two rounds at the per-round cap", () => {
    expect(fundSuggestions(3_000_000n).map((s) => s.amount)).toEqual([3_000_000n, 6_000_000n]);
    expect(fundSuggestions(0n)).toEqual([]);
  });
});

describe("contributor timeline", () => {
  const base = {
    joinedAt: new Date("2026-10-01T10:00:00Z"),
    programName: "Arc Builders",
    walletLinkedAt: new Date("2026-10-01T10:01:00Z"),
    githubVerifiedAt: null,
    paysGithub: false,
    submissions: [],
    payouts: [],
    round: { number: 1, endsAt: new Date("2026-10-08T10:00:00Z"), open: true },
    awaiting: 0n,
  };
  it("a new member: joined and wallet done, first submission is next", () => {
    const t = contributorTimeline(base);
    expect(t.map((s) => [s.key, s.state])).toEqual([
      ["joined", "done"],
      ["wallet", "done"],
      ["first-submission", "current"],
      ["first-approval", "waiting"],
      ["first-payout", "waiting"],
    ]);
    expect(t[0]!.label).toBe("Joined Arc Builders");
  });
  it("approved but unpaid: the payout waits for the round to close", () => {
    const t = contributorTimeline({
      ...base,
      submissions: [
        {
          createdAt: new Date("2026-10-02T09:00:00Z"),
          status: "approved",
          decidedAt: new Date("2026-10-02T09:01:00Z"),
        },
        { createdAt: new Date("2026-10-03T09:00:00Z"), status: "rejected", decidedAt: null },
      ],
      awaiting: 450_000n,
    });
    expect(t.find((s) => s.key === "first-submission")!.label).toBe("First submission · 2 so far");
    expect(t.find((s) => s.key === "first-approval")!.at?.toISOString()).toBe(
      "2026-10-02T09:01:00.000Z",
    );
    expect(t.find((s) => s.key === "first-payout")!.detail).toMatch(
      /0\.45 USDC approved, paid when round 1 closes/,
    );
    expect(t.at(-1)).toMatchObject({ key: "round-close", state: "waiting" });
  });
  it("paid: first payout with the total, GitHub only when the program pays for it", () => {
    const t = contributorTimeline({
      ...base,
      paysGithub: true,
      submissions: [
        { createdAt: new Date("2026-10-02T09:00:00Z"), status: "paid", decidedAt: null },
      ],
      payouts: [
        {
          amount: 620_000n,
          status: "executed",
          at: new Date("2026-10-03T12:00:00Z"),
          roundNumber: 1,
        },
        {
          amount: 100_000n,
          status: "failed",
          at: new Date("2026-10-04T12:00:00Z"),
          roundNumber: 2,
        },
      ],
    });
    expect(t.find((s) => s.key === "github")).toMatchObject({ state: "waiting" });
    expect(t.find((s) => s.key === "first-payout")).toMatchObject({
      state: "done",
      label: "First payout · 0.62 USDC",
    });
  });
  it("no wallet yet: linking it comes first", () => {
    const t = contributorTimeline({ ...base, walletLinkedAt: null });
    expect(t.find((s) => s.key === "wallet")!.state).toBe("current");
    expect(t.find((s) => s.key === "first-submission")!.state).toBe("waiting");
  });
});

describe("verify stepper", () => {
  const result = {
    steps: [
      { id: "record", state: "pass" as const },
      { id: "published", state: "pass" as const },
      { id: "signature", state: "fail" as const },
      { id: "payout", state: "skip" as const },
      { id: "chain", state: "skip" as const },
    ],
  };
  it("waits before anything is checked; the first check pulses while the server works", () => {
    expect(verifyStatuses(null, 0, false)).toEqual(Array(5).fill("waiting"));
    expect(verifyStatuses(null, 0, true)[0]).toBe("current");
  });
  it("reveals results one by one, with the next check in progress", () => {
    expect(verifyStatuses(result, 2, false)).toEqual([
      "done",
      "done",
      "current",
      "waiting",
      "waiting",
    ]);
    expect(verifyStatuses(result, 5, false)).toEqual([
      "done",
      "done",
      "failed",
      "skipped",
      "skipped",
    ]);
    expect(revealDone(4)).toBe(false);
    expect(revealDone(VERIFY_CHECKS.length)).toBe(true);
  });
});

describe("full-screen guided flows", async () => {
  const { isFocusRoute } = await import("@/components/app/focus-frame");
  it("the wizard, ready and setup screens leave the app rail; everything else keeps it", () => {
    const id = "1bcb003a-bec2-4950-aec5-c339272e5cb5";
    expect(isFocusRoute("/app/programs/new")).toBe(true);
    expect(isFocusRoute(`/app/programs/${id}/ready`)).toBe(true);
    expect(isFocusRoute(`/app/programs/${id}/setup`)).toBe(true);
    expect(isFocusRoute(`/app/programs/${id}`)).toBe(false);
    expect(isFocusRoute(`/app/programs/${id}/settings`)).toBe(false);
    expect(isFocusRoute("/app")).toBe(false);
  });
});
