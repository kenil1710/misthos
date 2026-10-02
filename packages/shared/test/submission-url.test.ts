import { describe, expect, it } from "vitest";
import { classifySubmissionUrl as c } from "../src/submission-url";

describe("classifySubmissionUrl", () => {
  it.each([
    ["https://x.com/alice/status/1840000000000000001", "x_post", "1840000000000000001"],
    [
      "https://twitter.com/alice/status/1840000000000000001?s=20&t=abc",
      "x_post",
      "1840000000000000001",
    ],
    [
      "https://mobile.twitter.com/alice/status/1840000000000000001/photo/1",
      "x_post",
      "1840000000000000001",
    ],
    ["https://x.com/i/web/status/1840000000000000001", "x_post", "1840000000000000001"],
    ["https://github.com/Arc-Builders/Payroll/pull/42", "github_pr", "arc-builders/payroll#42"],
    [
      "https://github.com/arc-builders/payroll/pull/42/files",
      "github_pr",
      "arc-builders/payroll#42",
    ],
    [
      `https://github.com/arc-builders/payroll/commit/${"A".repeat(40)}`,
      "github_commit",
      `arc-builders/payroll@${"a".repeat(40)}`,
    ],
    [
      `https://github.com/arc-builders/payroll/pull/42/commits/${"b".repeat(40)}`,
      "github_commit",
      `arc-builders/payroll@${"b".repeat(40)}`,
    ],
    [
      "https://www.Blog.example.com/posts/arc/?utm_source=x&b=2&a=1#intro",
      "article",
      "https://blog.example.com/posts/arc?a=1&b=2",
    ],
  ])("%s → %s %s", (url, type, id) => {
    const r = c(url);
    expect(r).toMatchObject({ ok: true, sourceType: type, resourceId: id });
  });

  it("gives the same id to equivalent links, so duplicates are caught", () => {
    const a = c("https://x.com/alice/status/1840000000000000001");
    const b = c("https://twitter.com/someone_else/status/1840000000000000001?s=46");
    expect(a.ok && b.ok && a.resourceId === b.resourceId).toBe(true);
  });

  it.each([
    ["not a url", /full link/],
    ["https://x.com/alice", /isn't a post/],
    ["https://github.com/a/b/issues/3", /pull request or a commit/],
    ["https://github.com/a/b/commit/abc1234", /40-character/],
    ["https://t.co/abc", /full link/],
    ["https://youtu.be/xyz", /YouTube/],
    ["javascript:alert(1)", /Only web links/],
    ["http://localhost:3000/a", /public web page/],
    ["http://169.254.169.254/latest/meta-data/", /public web page/],
    ["http://[::1]/", /public web page/],
    ["https://intranet/x", /public web page/],
    ["https://e.com:8443/x", /public web page/],
    ["https://user:pw@e.com/x", /credentials/],
  ])("rejects %s", (url, msg) => {
    const r = c(url);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(msg);
  });
});
