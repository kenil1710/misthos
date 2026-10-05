import { z } from "zod";
import { FetchError, type ApiUsageEntry, type Fetch, type FetchResult } from "../types";

/**
 * X API v2 post lookup: GET /2/tweets/:id with the author expanded (docs.x.com/x-api/posts/get-post-by-id).
 * Pay-per-use: $0.005 per post read + $0.010 per user read, deduplicated per UTC day (docs.x.com pricing,
 * verified 2026-10-02). We log the conservative $0.015 per lookup.
 *
 * Threads: when the post has replies, one recent search (`conversation_id:<id> from:<author id>`) reads the
 * author's own posts in the conversation, and the self-reply chain is rebuilt from the reply links. Billed per post
 * returned ($0.005 each) and capped at MAX_THREAD_POSTS, so a thread costs at most $0.125 on top of the lookup.
 */
export const X_API_BASE = "https://api.x.com";
export const X_LOOKUP_COST_USD = 0.015;
export const X_SEARCH_POST_COST_USD = 0.005;
/** Most posts read per thread (one search page). Longer threads are judged on the posts that fit, marked truncated. */
export const MAX_THREAD_POSTS = 25;
/** Recent search only sees the last 7 days (with a margin for clock skew and indexing). */
const RECENT_SEARCH_WINDOW_MS = 7 * 86_400_000 - 3_600_000;

const Metrics = z
  .object({
    retweet_count: z.number().default(0),
    reply_count: z.number().default(0),
    like_count: z.number().default(0),
    quote_count: z.number().default(0),
    impression_count: z.number().optional(),
  })
  .partial();

const Post = z.object({
  id: z.string(),
  text: z.string(),
  author_id: z.string(),
  created_at: z.string().optional(),
  conversation_id: z.string().optional(),
  in_reply_to_user_id: z.string().optional(),
  lang: z.string().optional(),
  public_metrics: Metrics.optional(),
  note_tweet: z.object({ text: z.string() }).optional(),
  referenced_tweets: z.array(z.object({ type: z.string(), id: z.string() })).optional(),
});
type Post = z.infer<typeof Post>;

const SearchResponse = z.object({
  data: z.array(Post).optional(),
  meta: z
    .object({ result_count: z.number().optional(), next_token: z.string().optional() })
    .optional(),
});

const Response = z.object({
  data: Post.optional(),
  includes: z
    .object({
      users: z
        .array(
          z.object({
            id: z.string(),
            username: z.string(),
            name: z.string().optional(),
            created_at: z.string().optional(),
            public_metrics: z.object({ followers_count: z.number() }).partial().optional(),
          }),
        )
        .optional(),
    })
    .optional(),
  errors: z
    .array(
      z.object({
        title: z.string().optional(),
        type: z.string().optional(),
        detail: z.string().optional(),
      }),
    )
    .optional(),
});

export function xPostUrl(id: string): string {
  const url = new URL(`/2/tweets/${id}`, X_API_BASE);
  url.searchParams.set(
    "tweet.fields",
    "author_id,created_at,public_metrics,text,referenced_tweets,conversation_id,lang,note_tweet",
  );
  url.searchParams.set("expansions", "author_id");
  url.searchParams.set("user.fields", "created_at,public_metrics,verified,username,name");
  return url.toString();
}

export function xThreadSearchUrl(conversationId: string, authorId: string): string {
  const url = new URL("/2/tweets/search/recent", X_API_BASE);
  url.searchParams.set("query", `conversation_id:${conversationId} from:${authorId} -is:retweet`);
  url.searchParams.set("max_results", String(MAX_THREAD_POSTS));
  url.searchParams.set(
    "tweet.fields",
    "author_id,created_at,conversation_id,in_reply_to_user_id,referenced_tweets,note_tweet,text",
  );
  return url.toString();
}

/** Full text of a post (long posts carry it in note_tweet; `text` is truncated), plus a marker for a quoted post. */
function postText(p: Post): string {
  const text = p.note_tweet?.text ?? p.text;
  const quoted = p.referenced_tweets?.find((r) => r.type === "quoted");
  return quoted ? `${text}\n[Quotes another post: https://x.com/i/web/status/${quoted.id}]` : text;
}

/** Snowflake ids grow with time; compare them exactly (they don't fit in a double). */
const byId = (a: Post, b: Post) => {
  const x = BigInt(a.id);
  const y = BigInt(b.id);
  return x < y ? -1 : x > y ? 1 : 0;
};

export interface SelfThread {
  posts: Post[];
  truncated: boolean;
  /** Why the thread may be incomplete, in words for the reviewer; null when nothing is missing. */
  note: string | null;
}

/**
 * The author's own reply chain starting at `root`: each next post is the author's earliest reply to the previous
 * one. The chain stops at the first post that isn't the author replying to themselves (a reply to someone else
 * never links in), so other people's posts are never attributed to the contributor.
 */
export function buildSelfThread(
  root: Post,
  found: Post[],
  opts: { max?: number; moreAvailable?: boolean } = {},
): SelfThread {
  const max = opts.max ?? MAX_THREAD_POSTS;
  const author = root.author_id;
  const parentOf = (p: Post) => p.referenced_tweets?.find((r) => r.type === "replied_to")?.id;
  const selfReplies = found.filter(
    (p) => p.id !== root.id && p.author_id === author && p.in_reply_to_user_id === author,
  );
  const children = new Map<string, Post[]>();
  for (const p of [...selfReplies].sort(byId)) {
    const parent = parentOf(p);
    if (!parent) continue;
    children.set(parent, [...(children.get(parent) ?? []), p]);
  }
  const posts = [root];
  let truncated = false;
  for (;;) {
    const next = children.get(posts.at(-1)!.id)?.[0];
    if (!next) break;
    if (posts.length >= max) {
      truncated = true;
      break;
    }
    posts.push(next);
  }
  if (opts.moreAvailable) truncated = true;
  const inChain = new Set(posts.map((p) => p.id));
  const known = new Set([root.id, ...found.map((p) => p.id)]);
  // A self-reply whose parent we never saw, posted after the chain's end: a post in between was deleted or hidden.
  const last = posts.at(-1)!;
  const orphan = selfReplies.some(
    (p) => !inChain.has(p.id) && !known.has(parentOf(p) ?? "") && byId(p, last) > 0,
  );
  const note = truncated
    ? `The thread is longer than ${max} posts; only the first ${posts.length} were read.`
    : orphan
      ? "A post in the thread is missing (deleted or unavailable); the thread was read up to the gap."
      : null;
  return { posts, truncated, note };
}

export async function fetchXPost(
  id: string,
  opts: {
    bearerToken: string;
    fetch?: Fetch;
    baseUrl?: string;
    now?: () => Date;
    thread?: boolean;
  },
): Promise<FetchResult> {
  const f = opts.fetch ?? fetch;
  const url = opts.baseUrl ? xPostUrl(id).replace(X_API_BASE, opts.baseUrl) : xPostUrl(id);
  let res: Response;
  try {
    res = await f(url, {
      headers: { Authorization: `Bearer ${opts.bearerToken}` },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new FetchError("X API unreachable", true);
  }
  const usage: ApiUsageEntry[] = [
    {
      provider: "x" as const,
      endpoint: "GET /2/tweets/:id",
      units: 1,
      estCostUsd: X_LOOKUP_COST_USD,
    },
  ];
  if (res.status === 429 || res.status >= 500)
    throw new FetchError(`X API ${res.status}`, true, res.status);
  if (res.status === 401 || res.status === 403)
    throw new FetchError(`X API rejected our credentials (${res.status})`, false, res.status);
  if (res.status === 404)
    return { outcome: { status: "not_found", detail: "The post no longer exists." }, usage };
  if (!res.ok) throw new FetchError(`X API ${res.status}`, false, res.status);

  const body = Response.safeParse(await res.json());
  if (!body.success) throw new FetchError("Unexpected X API response", false);
  const { data, includes, errors } = body.data;
  if (!data) {
    const e = errors?.[0];
    const notFound = !e || /not.?found/i.test(`${e.title} ${e.type}`);
    if (notFound)
      return {
        outcome: { status: "not_found", detail: "The post was deleted or never existed." },
        usage,
      };
    throw new FetchError(
      /authoriz/i.test(`${e.title}`)
        ? "The post is from a protected account."
        : "X refused to return the post.",
      false,
    );
  }

  const author = includes?.users?.find((u) => u.id === data.author_id);
  const refs = data.referenced_tweets ?? [];
  const m = data.public_metrics ?? {};
  const isRepost = refs.some((r) => r.type === "retweeted");

  // ── The author's self-reply thread (only when someone, possibly the author, replied) ──
  let thread: SelfThread = { posts: [data], truncated: false, note: null };
  const now = (opts.now ?? (() => new Date()))().getTime();
  const posted = data.created_at ? Date.parse(data.created_at) : NaN;
  if (opts.thread !== false && !isRepost && (m.reply_count ?? 0) > 0) {
    if (Number.isFinite(posted) && now - posted > RECENT_SEARCH_WINDOW_MS) {
      thread.note =
        "Replies weren't read: X search only covers the last 7 days, so only this post was judged.";
    } else {
      thread = await fetchSelfThread(data, f, opts, usage);
    }
  }
  const threadPosts = thread.posts;
  const text =
    threadPosts.length > 1
      ? threadPosts
          .map((p, i) => `[Post ${i + 1} of ${threadPosts.length}]\n${postText(p)}`)
          .join("\n\n")
      : // Long posts carry the full text in note_tweet; `text` is truncated.
        (data.note_tweet?.text ?? data.text);
  return {
    usage,
    outcome: {
      status: "ok",
      resource: {
        sourceType: "x_post",
        resourceId: data.id,
        url: `https://x.com/${author?.username ?? "i/web"}/status/${data.id}`,
        timestamp: data.created_at ?? null,
        timestampKind: data.created_at ? "posted" : "unknown",
        title: null,
        text,
        author: {
          id: data.author_id,
          handle: author?.username ?? null,
          name: author?.name ?? null,
          createdAt: author?.created_at ?? null,
          followers: author?.public_metrics?.followers_count ?? null,
        },
        x: {
          isRepost,
          isReply: refs.some((r) => r.type === "replied_to"),
          isQuote: refs.some((r) => r.type === "quoted"),
          likes: m.like_count ?? 0,
          reposts: m.retweet_count ?? 0,
          replies: m.reply_count ?? 0,
          quotes: m.quote_count ?? 0,
          impressions: m.impression_count ?? null,
          lang: data.lang ?? null,
          thread: {
            postIds: threadPosts.map((p) => p.id),
            truncated: thread.truncated,
            note: thread.note,
          },
        },
      },
    },
  };
}

/**
 * One recent-search page of the author's posts in this conversation, chained from the submitted post. Rate limits and
 * outages are retried by the queue; any other failure falls back to the single post, with a note for the reviewer.
 */
async function fetchSelfThread(
  root: Post,
  f: Fetch,
  opts: { bearerToken: string; baseUrl?: string },
  usage: ApiUsageEntry[],
): Promise<SelfThread> {
  const single = (note: string): SelfThread => ({ posts: [root], truncated: false, note });
  const base = xThreadSearchUrl(root.conversation_id ?? root.id, root.author_id);
  const url = opts.baseUrl ? base.replace(X_API_BASE, opts.baseUrl) : base;
  let res: Response;
  try {
    res = await f(url, {
      headers: { Authorization: `Bearer ${opts.bearerToken}` },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new FetchError("X API unreachable", true);
  }
  if (res.status === 429 || res.status >= 500)
    throw new FetchError(`X API ${res.status}`, true, res.status);
  const body = res.ok ? SearchResponse.safeParse(await res.json()) : null;
  const found = body?.success ? (body.data.data ?? []) : [];
  usage.push({
    provider: "x",
    endpoint: "GET /2/tweets/search/recent",
    units: found.length,
    estCostUsd: found.length * X_SEARCH_POST_COST_USD,
    meta: { purpose: "thread", conversationId: root.conversation_id ?? root.id },
  });
  if (!body?.success)
    return single("The replies couldn't be read from X, so only this post was judged.");
  return buildSelfThread(root, found, { moreAvailable: !!body.data.meta?.next_token });
}
