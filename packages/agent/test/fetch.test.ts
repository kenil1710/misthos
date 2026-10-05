import { describe, expect, it } from "vitest";
import { parseArticle } from "../src/fetch/article";
import { fetchGithubCommit, fetchGithubPr } from "../src/fetch/github";
import { assertFetchableUrl, isPublicAddress } from "../src/fetch/safe-fetch";
import { buildSelfThread, fetchXPost, MAX_THREAD_POSTS, xPostUrl } from "../src/fetch/x";
import { FetchError } from "../src/types";
import { fixture, fixtureFetch, fixtureText } from "./helpers";

const NO_REPLIES = { json: { meta: { result_count: 0 } } };
const x = (name: string) =>
  fixtureFetch({
    "/2/tweets/search/recent": NO_REPLIES,
    "/2/tweets/": { json: fixture(`x/${name}.json`) },
  });

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
      {
        provider: "x",
        endpoint: "GET /2/tweets/search/recent",
        units: 0,
        estCostUsd: 0,
        meta: { purpose: "thread", conversationId: "1840000000000000001" },
      },
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

  it("parses a real recorded X response (impression_count 0 on old posts)", async () => {
    const recorded = fixture<{ body: unknown }>("recorded/x-2-tweets-20.json").body;
    const r = await fetchXPost("20", {
      bearerToken: "t",
      fetch: fixtureFetch({ "/2/tweets/": { json: recorded } }),
    });
    if (r.outcome.status !== "ok") throw new Error("expected ok");
    expect(r.outcome.resource).toMatchObject({
      text: "just setting up my twttr",
      author: { id: "12", handle: "jack" },
      x: { impressions: 0 },
    });
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

describe("X threads", () => {
  // Recorded live on 2026-10-05: a real 4-post self-thread (opener + three replies by the same account).
  const ROOT = "2107001684937543903";
  const AUTHOR = "1489870982810861568";
  type Body = { data: Record<string, unknown>[] | Record<string, unknown>; meta?: object };
  const root = () =>
    structuredClone(fixture<{ body: Body }>(`recorded/x-2-tweets-${ROOT}.json`).body);
  const search = () =>
    structuredClone(
      fixture<{ body: { data: Record<string, unknown>[]; meta: Record<string, unknown> } }>(
        `recorded/x-2-tweets-search-recent-conversation-${ROOT}.json`,
      ).body,
    );
  const now = () => new Date("2026-10-05T07:00:00Z");
  const stub = (searchJson: unknown, rootJson: unknown = root(), status = 200) =>
    fixtureFetch({
      "/2/tweets/search/recent": { json: searchJson, status },
      "/2/tweets/": { json: rootJson },
    });
  const read = async (f: ReturnType<typeof stub>, opts: { thread?: boolean; at?: Date } = {}) => {
    const r = await fetchXPost(ROOT, {
      bearerToken: "t",
      fetch: f,
      now: () => opts.at ?? now(),
      thread: opts.thread,
    });
    if (r.outcome.status !== "ok") throw new Error("expected ok");
    return { ...r, resource: r.outcome.resource };
  };
  const REPLIES = ["2107001686963450333", "2107001689261875621", "2107001692223095074"];

  it("reads a real self-thread in order, gives the judge every post with the count, and logs the cost", async () => {
    const f = stub(search());
    const { resource, usage } = await read(f);
    expect(resource.x?.thread).toEqual({
      postIds: [ROOT, ...REPLIES],
      truncated: false,
      note: null,
    });
    expect(resource.text).toMatch(/^\[Post 1 of 4\]\nBuilding on @arc this week/);
    expect(resource.text).toContain("[Post 2 of 4]\n1/ USDC is the gas token on Arc.");
    expect(resource.text).toContain("[Post 3 of 4]\n2/ Fees are paid in USDC");
    expect(resource.text).toMatch(/\[Post 4 of 4\]\n3\/ If an AI agent moves money.*unique ID\.$/s);
    expect(resource.author).toMatchObject({ id: AUTHOR, handle: "vekariya_kenil" });
    expect(usage).toEqual([
      { provider: "x", endpoint: "GET /2/tweets/:id", units: 1, estCostUsd: 0.015 },
      {
        provider: "x",
        endpoint: "GET /2/tweets/search/recent",
        units: 4,
        estCostUsd: 0.02,
        meta: { purpose: "thread", conversationId: ROOT },
      },
    ]);
    const url = new URL(String(f.mock.calls[1]![0]));
    expect(url.pathname).toBe("/2/tweets/search/recent");
    expect(url.searchParams.get("query")).toBe(
      `conversation_id:${ROOT} from:${AUTHOR} -is:retweet`,
    );
    expect(url.searchParams.get("max_results")).toBe(String(MAX_THREAD_POSTS));
  });

  it("treats a post nobody replied to as a single post and doesn't search", async () => {
    const single = root();
    (single.data as { public_metrics: { reply_count: number } }).public_metrics.reply_count = 0;
    const f = stub(search(), single);
    const { resource, usage } = await read(f);
    expect(f).toHaveBeenCalledTimes(1);
    expect(usage).toHaveLength(1);
    expect(resource.text).toBe(
      "Building on @arc this week taught me a few things about stablecoin-native chains that I didn't expect. A short thread for builders 🧵",
    );
    expect(resource.x?.thread).toEqual({ postIds: [ROOT], truncated: false, note: null });
  });

  it("stops at the first post that isn't the author replying to themselves", async () => {
    const s = search();
    s.data.push(
      // The author answering someone else's reply: not part of the thread.
      {
        id: "2107001700000000001",
        author_id: AUTHOR,
        in_reply_to_user_id: "42",
        referenced_tweets: [{ type: "replied_to", id: "2107001699999999999" }],
        text: "thanks!",
      },
      // Someone else replying to the last post (would never match from:, but must not link in either).
      {
        id: "2107001700000000002",
        author_id: "42",
        in_reply_to_user_id: AUTHOR,
        referenced_tweets: [{ type: "replied_to", id: REPLIES[2]! }],
        text: "4/ my words, not theirs",
      },
    );
    const { resource } = await read(stub(s));
    expect(resource.x?.thread?.postIds).toEqual([ROOT, ...REPLIES]);
    expect(resource.text).not.toContain("thanks!");
    expect(resource.text).not.toContain("my words");
  });

  it("ends at a deleted post and tells the judge the thread has a gap", async () => {
    const s = search();
    s.data = s.data.filter((p) => p.id !== REPLIES[0]); // "1/" deleted
    const { resource } = await read(stub(s));
    expect(resource.x?.thread).toMatchObject({ postIds: [ROOT], truncated: false });
    expect(resource.x?.thread?.note).toMatch(/missing \(deleted or unavailable\)/);
  });

  it("caps long threads and marks them truncated", async () => {
    const s = search();
    s.meta.next_token = "more";
    const { resource } = await read(stub(s));
    expect(resource.x?.thread?.truncated).toBe(true);
    expect(resource.x?.thread?.note).toMatch(/longer than 25 posts/);
    const posts = (search().data as Parameters<typeof buildSelfThread>[1]).reverse();
    const capped = buildSelfThread(posts[0]!, posts, { max: 2 });
    expect(capped.posts.map((p) => p.id)).toEqual([ROOT, REPLIES[0]]);
    expect(capped).toMatchObject({ truncated: true });
  });

  it("shows a quoted post as a link, never as the contributor's text", async () => {
    const s = search();
    const reply = s.data.find((p) => p.id === REPLIES[1])!;
    reply.referenced_tweets = [
      ...(reply.referenced_tweets as object[]),
      { type: "quoted", id: "1999999999999999999" },
    ];
    const { resource } = await read(stub(s));
    expect(resource.text).toContain(
      "2/ Fees are paid in USDC, so users never need a second token. With Circle's Gas Station, an agent wallet can even send transactions with its gas sponsored, holding zero balance itself.\n[Quotes another post: https://x.com/i/web/status/1999999999999999999]",
    );
    expect(resource.x?.thread?.postIds).toHaveLength(4);
  });

  it("retries on rate limits, and falls back to the single post when the search fails otherwise", async () => {
    await expect(read(stub({}, root(), 429))).rejects.toMatchObject({ retryable: true });
    const { resource } = await read(stub({ title: "Invalid Request" }, root(), 400));
    expect(resource.x?.thread).toMatchObject({ postIds: [ROOT] });
    expect(resource.x?.thread?.note).toMatch(/replies couldn't be read/);
  });

  it("skips the search outside X's 7-day window and for payout re-checks", async () => {
    const late = stub(search());
    const old = await read(late, { at: new Date("2026-10-13T00:00:00Z") });
    expect(late).toHaveBeenCalledTimes(1);
    expect(old.resource.x?.thread?.note).toMatch(/last 7 days/);
    const recheck = stub(search());
    const r = await read(recheck, { thread: false });
    expect(recheck).toHaveBeenCalledTimes(1);
    expect(r.resource.x?.thread?.postIds).toEqual([ROOT]);
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

  it("F-05: a commit counts only on the default branch, dated by when its PR merged there", async () => {
    const sha = "a".repeat(40);
    const commitFetch = (compare: string, pulls: unknown[]) =>
      fixtureFetch({
        "/pulls": { json: pulls },
        "/compare/": { json: { status: compare } },
        "/commits/": { json: fixture("github/commit.json") },
        "/repos/arc-builders/payroll": { json: { default_branch: "main" } },
      });
    const read = async (compare: string, pulls: unknown[]) => {
      const r = await fetchGithubCommit(`arc-builders/payroll@${sha}`, {
        token: "g",
        fetch: commitFetch(compare, pulls),
      });
      if (r.outcome.status !== "ok") throw new Error("expected ok");
      return r.outcome.resource;
    };
    // Merged into main through a pull request: on the default branch, dated by the merge (not the commit date).
    const merged = await read("behind", [
      { merged_at: "2026-10-07T08:00:00Z", base: { ref: "main" } },
    ]);
    expect(merged).toMatchObject({
      timestamp: "2026-10-07T08:00:00Z",
      timestampKind: "merged",
      author: { handle: "alice-dev" },
      github: { merged: true },
    });
    // Only in a fork (GitHub still serves it under the upstream URL): not on main → NOT_MERGED, hard.
    const fork = await read("diverged", []);
    expect(fork.github).toMatchObject({ merged: false });
    const { runChecks } = await import("../src/checks");
    const { CATEGORIES } = await import("./helpers");
    const checks = (r: typeof fork) =>
      runChecks({
        sourceType: "github_commit",
        resource: r,
        contributor: {
          id: "c",
          xUserId: "1",
          xHandle: "alice",
          githubLogin: "alice-dev",
          githubUserId: r.author.id,
          walletChangedAt: null,
        },
        round: {
          startsAt: new Date("2026-10-05T00:00:00Z"),
          endsAt: new Date("2026-10-19T00:00:00Z"),
        },
        program: { minAccountAgeDays: 0, payeeCooldownSeconds: 0, categories: CATEGORIES },
        sameResource: [],
        similar: [],
        submittedAt: new Date("2026-10-08T00:00:00Z"),
      }).map((f) => `${f.code}:${f.severity}`);
    expect(checks(fork)).toContain("NOT_MERGED:hard");
    // Pushed straight to main: on the branch, but when it landed can't be proven → no date → a person reviews it.
    const pushed = await read("identical", []);
    expect(pushed).toMatchObject({ timestamp: null, github: { merged: true } });
    expect(checks(pushed)).toContain("DATE_UNVERIFIED:soft");
    expect(checks(merged)).toEqual([]);
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
    expect(o.resource.article?.authorHandles).toEqual(["alice_builds"]); // from twitter:creator
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
    "2002:7f00:1::1", // 6to4 wrapping 127.0.0.1
    "2001:0:4136:e378:8000:63bf:3fff:fdd2", // Teredo
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
