import { describe, expect, it } from "vitest";
import { decisionChanged } from "@/lib/contributor-live";

const item = (id: string, status: string, hash: string | null = null) => ({
  id,
  status,
  decision: hash ? { decisionHash: hash } : null,
});

describe("contributor page follows its submission list", () => {
  it("refreshes when a polled submission is decided, re-decided or paid", () => {
    expect(decisionChanged([item("a", "processing")], [item("a", "approved", "0x1")])).toBe(true);
    expect(decisionChanged([item("a", "escalated", "0x1")], [item("a", "escalated", "0x2")])).toBe(
      true,
    );
    expect(decisionChanged([item("a", "approved", "0x1")], [item("a", "paid", "0x1")])).toBe(true);
  });
  it("stays put while nothing changed (no refresh on every poll)", () => {
    expect(decisionChanged([item("a", "processing")], [item("a", "processing")])).toBe(false);
    expect(decisionChanged([item("a", "pending")], [item("b", "approved", "0x1")])).toBe(false);
  });
});
