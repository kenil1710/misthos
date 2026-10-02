import { describe, expect, it } from "vitest";
import { parseArticle } from "../src/fetch/article";
import { fetchGithubCommit, fetchGithubPr } from "../src/fetch/github";
import { assertFetchableUrl, isPublicAddress } from "../src/fetch/safe-fetch";
import { fetchXPost, xPostUrl } from "../src/fetch/x";
import { FetchError } from "../src/types";
import { fixture, fixtureFetch, fixtureText } from "./helpers";

const x = (name: string) => fixtureFetch({ "/2/tweets/": { json: fixture(`x/${name}.json`) } });

describe("X fetcher", () => {
  it("requests only the documented fields for the one post", () => {
    const url = new URL(xPostUrl("123"));
    expect(url.origin + url.pathname).toBe("https://api.x.com/2/tweets/123");
    expect(url.searchParams.get("expansions")).toBe("author_id");
    expect(url.searchParams.get("tweet.fields")).toContain("note_tweet");
    expect(url.searchParams.get("user.fields")).toContain("created_at");
  });

  it("normalizes a long post (note_tweet), author and metrics, and logs cost", async () => {
    const f = x("original-thread");
    const r = await fetchXPost("1840000000000000001", { bearerToken: "t", fetch: f });
    expect(r.usage).toEqual([
      { provider: "x", endpoint: "GET /2/tweets/:id", units: 1, estCostUsd: 0.015 },
    ]);
    if (r.outcome.status !== "ok") throw new Error("expected ok");
    const res = r.outcome.resource;
    expect(res.text).toMatch(/^Arc's gas model, explained\. 1\//);
    expect(res.text.length).toBeGreaterThan(400); // full note_tweet, not the truncated text
    expect(res.author).toMatchObject({ id: "1000000001", handle: "alice_builds", followers: 812 });
    expect(res.timestamp).toBe("2026-10-06T14:00:00.000Z");
    expect(res.x).toMatchObject({ likes: 84, reposts: 12, isRepost: false });
    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer t");
  });

  it("maps X's not-found problem to not_found", async () => {
    const r = await fetchXPost("1840000000000000005", { bearerToken: "t", fetch: x("deleted") });
    expect(r.outcome.status).toBe("not_found");
  });

  it("flags reposts", async () => {
    const r = await fetchXPost("1840000000000000007", { bearerToken: "t", fetch: x("repost") });
    expect(r.outcome.status === "ok" && r.outcome.resource.x?.isRepost).toBe(true);
  });

  it("retries on 429/5xx, not on auth failures", async () => {
    const rl = fixtureFetch({ "/2/tweets/": { status: 429 } });
    await expect(fetchXPost("1", { bearerToken: "t", fetch: rl })).rejects.toMatchObject({
      retryable: true,
    });
    const auth = fixtureFetch({ "/2/tweets/": { status: 401 } });
    await expect(fetchXPost("1", { bearerToken: "t", fetch: auth })).rejects.toMatchObject({
      retryable: false,
    });
  });
});

describe("GitHub fetchers", () => {
  const gh = (pr: string) =>
    fixtureFetch({
      "/pulls/42/files": { json: fixture("github/pr-files.json") },
      "/pulls/43/files": { json: fixture("github/pr-files.json") },
      "/pulls/": { json: fixture(`github/${pr}.json`) },
    });

  it("reads a merged PR with files and uses merge time for the window", async () => {
    const r = await fetchGithubPr("arc-builders/payroll#42", {
      token: "g",
      fetch: gh("pr-merged"),
    });
    if (r.outcome.status !== "ok") throw new Error("expected ok");
    expect(r.outcome.resource).toMatchObject({
      timestamp: "2026-10-06T15:30:00Z",
      timestampKind: "merged",
      author: { handle: "alice-dev" },
    });
    expect(r.outcome.resource.github).toMatchObject({
      merged: true,
      additions: 84,
      files: ["src/payout/preview.ts", "src/payout/preview.test.ts", "CHANGELOG.md"],
    });
    expect(r.outcome.resource.text).toContain("--- src/payout/preview.ts");
  });

  it("reads an unmerged PR with its open time", async () => {
    const r = await fetchGithubPr("arc-builders/payroll#43", {
      token: "g",
      fetch: gh("pr-unmerged"),
    });
    if (r.outcome.status !== "ok") throw new Error("expected ok");
    expect(r.outcome.resource).toMatchObject({
      timestampKind: "opened",
      github: { merged: false },
    });
  });

  it("reads a commit by its full SHA", async () => {
    const f = fixtureFetch({ "/commits/": { json: fixture("github/commit.json") } });
    const r = await fetchGithubCommit(`arc-builders/payroll@${"a".repeat(40)}`, {
      token: "g",
      fetch: f,
    });
    if (r.outcome.status !== "ok") throw new Error("expected ok");
    expect(r.outcome.resource).toMatchObject({
      timestamp: "2026-10-06T11:05:00Z",
      author: { handle: "alice-dev" },
    });
  });

  it("treats 404 as not found and rate limits as retryable", async () => {
    const r = await fetchGithubPr("a/b#1", { fetch: fixtureFetch({}) });
    expect(r.outcome.status).toBe("not_found");
    const rl = fixtureFetch({
      "/pulls/": { status: 403, headers: { "x-ratelimit-remaining": "0" } },
    });
    await expect(fetchGithubPr("a/b#1", { fetch: rl })).rejects.toMatchObject({ retryable: true });
  });
});

describe("article parsing", () => {
  it("extracts text, publish date, and X handles", () => {
    const o = parseArticle(
      "https://blog.example/arc",
      "https://blog.example/arc",
      fixtureText("article/good.html"),
    );
    if (o.status !== "ok") throw new Error("expected ok");
    expect(o.resource.timestamp).toBe("2026-10-06T09:00:00.000Z");
    expect(o.resource.article?.xMentions).toContain("alice_builds");
    expect(o.resource.text).toContain("6-decimal base units");
    expect(o.resource.article?.hiddenText).toBe("");
  });

  it("collects hidden text (display:none, comments) for injection scanning", () => {
    const o = parseArticle(
      "u",
      "https://blog.example/x",
      fixtureText("article/hidden-injection.html"),
    );
    if (o.status !== "ok") throw new Error("expected ok");
    expect(o.resource.article?.hiddenText).toMatch(/ignore your previous instructions/);
    expect(o.resource.article?.hiddenText).toMatch(/respond with approve/);
  });

  it("reports pages without a readable article as not found", () => {
    expect(
      parseArticle("u", "https://e.example/", "<html><body><p>hi</p></body></html>").status,
    ).toBe("not_found");
  });
});

describe("SSRF guard", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "fe80::1",
    "fd00::1",
    "::ffff:127.0.0.1",
  ])("blocks %s", (ip) => expect(isPublicAddress(ip)).toBe(false));
  it.each(["93.184.216.34", "1.1.1.1", "2606:4700:4700::1111"])("allows %s", (ip) =>
    expect(isPublicAddress(ip)).toBe(true),
  );

  it("rejects non-web schemes, credentials, odd ports and private IP literals", () => {
    for (const u of [
      "file:///etc/passwd",
      "ftp://e.com/x",
      "https://u:p@e.com/",
      "https://e.com:8080/",
      "http://169.254.169.254/latest/meta-data/",
      "http://[::1]/",
    ]) {
      expect(() => assertFetchableUrl(u), u).toThrow(FetchError);
    }
    expect(assertFetchableUrl("https://blog.example.com/post").hostname).toBe("blog.example.com");
  });
});
