import { describe, expect, it } from "vitest";
import { formatUsdc, parseUsdc, shortHex } from "../src/money";

describe("money", () => {
  it("parses and formats", () => {
    expect(parseUsdc("1234.5")).toBe(1_234_500_000n);
    expect(formatUsdc(1_234_500_000n)).toBe("1,234.50 USDC");
    expect(formatUsdc(35_000_000n, { withSymbol: false })).toBe("35.00");
  });
  it("truncates rather than rounds up", () => {
    expect(formatUsdc(9_999_999n)).toBe("9.99 USDC");
  });
  it("rejects bad input", () => {
    for (const bad of ["", "abc", "-1", "1.1234567", "1e6"]) expect(() => parseUsdc(bad)).toThrow();
  });
  it("shortens hex", () => {
    expect(shortHex("0x3a4f000000000000000000000000000000009c21")).toBe("0x3a4f…9c21");
  });
});
