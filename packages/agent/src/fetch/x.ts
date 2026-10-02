import { z } from "zod";
import { FetchError, type Fetch, type FetchResult } from "../types";

/**
 * X API v2 post lookup: GET /2/tweets/:id with the author expanded (docs.x.com/x-api/posts/get-post-by-id).
 * Pay-per-use: $0.005 per post read + $0.010 per user read, deduplicated per UTC day (docs.x.com pricing,
 * verified 2026-10-02). We log the conservative $0.015 per lookup.
 */
export const X_API_BASE = "https://api.x.com";
export const X_LOOKUP_COST_USD = 0.015;

const Metrics = z
  .object({
    retweet_count: z.number().default(0),
    reply_count: z.number().default(0),
    like_count: z.number().default(0),
    quote_count: z.number().default(0),
    impression_count: z.number().optional(),
  })
  .partial();

const Response = z.object({
  data: z
    .object({
      id: z.string(),
      text: z.string(),
      author_id: z.string(),
      created_at: z.string().optional(),
      lang: z.string().optional(),
      public_metrics: Metrics.optional(),
      note_tweet: z.object({ text: z.string() }).optional(),
      referenced_tweets: z.array(z.object({ type: z.string(), id: z.string() })).optional(),
    })
    .optional(),
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

export async function fetchXPost(
  id: string,
  opts: { bearerToken: string; fetch?: Fetch; baseUrl?: string },
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
  const usage = [
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
        // Long posts carry the full text in note_tweet; `text` is truncated.
        text: data.note_tweet?.text ?? data.text,
        author: {
          id: data.author_id,
          handle: author?.username ?? null,
          name: author?.name ?? null,
          createdAt: author?.created_at ?? null,
          followers: author?.public_metrics?.followers_count ?? null,
        },
        x: {
          isRepost: refs.some((r) => r.type === "retweeted"),
          isReply: refs.some((r) => r.type === "replied_to"),
          isQuote: refs.some((r) => r.type === "quoted"),
          likes: m.like_count ?? 0,
          reposts: m.retweet_count ?? 0,
          replies: m.reply_count ?? 0,
          quotes: m.quote_count ?? 0,
          impressions: m.impression_count ?? null,
          lang: data.lang ?? null,
        },
      },
    },
  };
}
