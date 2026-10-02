import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { setEnvLine } from "../scripts/env-file";

const file = (content: string) => {
  const p = path.join(mkdtempSync(path.join(tmpdir(), "envtest-")), ".env");
  writeFileSync(p, content);
  return p;
};

describe("setEnvLine", () => {
  it("fills an empty line in place and leaves every other byte alone", () => {
    const original = "# header\nA=1\nCIRCLE_ENTITY_SECRET=\nB=two words\n\n# tail\n";
    const p = file(original);
    expect(setEnvLine(p, "CIRCLE_ENTITY_SECRET", "abc")).toBe("filled");
    expect(readFileSync(p, "utf8")).toBe(
      original.replace("CIRCLE_ENTITY_SECRET=\n", "CIRCLE_ENTITY_SECRET=abc\n"),
    );
  });

  it("appends a missing key with an optional comment", () => {
    const p = file("A=1");
    expect(setEnvLine(p, "NEW", "x", "note")).toBe("appended");
    expect(readFileSync(p, "utf8")).toBe("A=1\n# note\nNEW=x\n");
  });

  it("never overwrites an existing value", () => {
    const p = file("K=keep\n");
    expect(() => setEnvLine(p, "K", "other")).toThrow(/not overwriting/);
    expect(setEnvLine(p, "K", "keep")).toBe("unchanged");
    expect(readFileSync(p, "utf8")).toBe("K=keep\n");
  });
});
