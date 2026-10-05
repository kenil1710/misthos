import { describe, expect, it } from "vitest";
import { classifyWalletError, isWalletNoise } from "@/lib/wallet-errors";

describe("classifyWalletError (calm messages for every connector failure)", () => {
  it("WalletConnect's expired proposal", () => {
    expect(classifyWalletError(new Error("Proposal expired"))).toEqual({
      kind: "expired",
      message: "Connection request expired. Try again.",
    });
  });
  it("user rejected (EIP-1193 4001, viem's wrapped error, plain text)", () => {
    expect(classifyWalletError({ code: 4001, message: "nope" }).kind).toBe("rejected");
    expect(
      classifyWalletError({ shortMessage: "User rejected the request.", cause: { code: 4001 } })
        .kind,
    ).toBe("rejected");
    expect(classifyWalletError("User denied account authorization").kind).toBe("rejected");
  });
  it("modal closed / connection reset", () => {
    expect(classifyWalletError(new Error("Connection request reset. Please try again.")).kind).toBe(
      "closed",
    );
    expect(classifyWalletError(new Error("Modal closed by user")).kind).toBe("closed");
  });
  it("a request already open in the wallet", () => {
    expect(classifyWalletError({ code: -32002, message: "Request already pending" }).kind).toBe(
      "pending",
    );
  });
  it("anything else is a generic retryable message, never a throw", () => {
    expect(classifyWalletError(undefined).kind).toBe("unknown");
    expect(classifyWalletError(new Error("boom")).message).toBe(
      "Couldn't connect to your wallet. Try again.",
    );
  });
});

describe("isWalletNoise (which unhandled rejections the guard swallows)", () => {
  it("swallows connector rejections", () => {
    const e = new Error("Proposal expired");
    e.stack = "Error: Proposal expired\n at node_modules/@walletconnect/utils/dist/index.js";
    expect(isWalletNoise(e)).toBe(true);
    expect(isWalletNoise({ message: "User rejected the request." })).toBe(true);
  });
  it("lets our own bugs through", () => {
    const e = new TypeError("Cannot read properties of undefined (reading 'map')");
    e.stack = "TypeError: ...\n at src/components/contributor/submissions.tsx";
    expect(isWalletNoise(e)).toBe(false);
  });
});
