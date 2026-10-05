import { z } from "zod";
import { FetchError, type Fetch, type FetchResult, type Resource } from "../types";

/** GitHub REST v2022-11-28. Only the submitted PR or commit is read. */
export const GITHUB_API_BASE = "https://api.github.com";
const MAX_PATCH_CHARS = 8_000;

const Pull = z.object({
  number: z.number(),
  title: z.string(),
  body: z.string().nullable(),
  state: z.string(),
  html_url: z.string(),
  created_at: z.string(),
  merged: z.boolean().nullable().optional(),
  merged_at: z.string().nullable(),
  additions: z.number(),
  deletions: z.number(),
  changed_files: z.number(),
  user: z.object({ login: z.string(), id: z.number() }).nullable(),
});

const File = z.object({
  filename: z.string(),
  additions: z.number(),
  deletions: z.number(),
  patch: z.string().optional(),
});

const Commit = z.object({
  sha: z.string(),
  html_url: z.string(),
  author: z.object({ login: z.string(), id: z.number() }).nullable(),
  commit: z.object({
    message: z.string(),
    author: z.object({ name: z.string(), date: z.string() }).nullable(),
    committer: z.object({ date: z.string() }).nullable(),
  }),
  stats: z.object({ additions: z.number(), deletions: z.number() }).optional(),
  files: z.array(File).optional(),
});

const RepoInfo = z.object({ default_branch: z.string() });
const CompareInfo = z.object({ status: z.string() });
const PullsForCommit = z.array(
  z.object({ merged_at: z.string().nullable(), base: z.object({ ref: z.string() }).optional() }),
);

function headers(token?: string) {
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "misthos-agent",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function get(
  path: string,
  opts: { token?: string; fetch?: Fetch; baseUrl?: string },
): Promise<Response> {
  const f = opts.fetch ?? fetch;
  let res: Response;
  try {
    res = await f(`${opts.baseUrl ?? GITHUB_API_BASE}${path}`, {
      headers: headers(opts.token),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new FetchError("GitHub unreachable", true);
  }
  // 403 with exhausted rate limit is retryable; other 403s (e.g. blocked) are not.
  if (
    res.status === 429 ||
    res.status >= 500 ||
    (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0")
  ) {
    throw new FetchError(`GitHub ${res.status}`, true, res.status);
  }
  if (res.status === 401) throw new FetchError("GitHub rejected our token", false, 401);
  return res;
}

function patchDigest(files: z.infer<typeof File>[]): string {
  let out = "";
  for (const f of files) {
    const header = `\n--- ${f.filename} (+${f.additions} −${f.deletions})\n`;
    if (out.length + header.length > MAX_PATCH_CHARS) break;
    out += header;
    if (f.patch) out += f.patch.slice(0, Math.max(0, MAX_PATCH_CHARS - out.length));
  }
  return out;
}

const github = (
  repo: string,
  extra: Partial<NonNullable<Resource["github"]>>,
): NonNullable<Resource["github"]> => ({
  repo,
  state: null,
  merged: false,
  mergedAt: null,
  additions: 0,
  deletions: 0,
  changedFiles: 0,
  files: [],
  ...extra,
});

/** resourceId "owner/repo#123" */
export async function fetchGithubPr(
  resourceId: string,
  opts: { token?: string; fetch?: Fetch; baseUrl?: string },
): Promise<FetchResult> {
  const m = /^([^/]+)\/([^#]+)#(\d+)$/.exec(resourceId);
  if (!m) throw new FetchError("Malformed pull request id", false);
  const [, owner, repo, num] = m;
  const usage = [
    { provider: "github" as const, endpoint: "GET /repos/:o/:r/pulls/:n", units: 2, estCostUsd: 0 },
  ];
  const res = await get(`/repos/${owner}/${repo}/pulls/${num}`, opts);
  if (res.status === 404)
    return {
      outcome: { status: "not_found", detail: "The pull request doesn't exist or isn't public." },
      usage,
    };
  if (!res.ok) throw new FetchError(`GitHub ${res.status}`, false, res.status);
  const pr = Pull.safeParse(await res.json());
  if (!pr.success) throw new FetchError("Unexpected GitHub response", false);
  const filesRes = await get(`/repos/${owner}/${repo}/pulls/${num}/files?per_page=100`, opts);
  const files = filesRes.ok
    ? z
        .array(File)
        .catch([])
        .parse(await filesRes.json())
    : [];
  const p = pr.data;
  const merged = p.merged ?? p.merged_at !== null;

  return {
    usage,
    outcome: {
      status: "ok",
      resource: {
        sourceType: "github_pr",
        resourceId,
        url: p.html_url,
        timestamp: merged ? p.merged_at : p.created_at,
        timestampKind: merged ? "merged" : "opened",
        title: p.title,
        text: `${p.title}\n\n${p.body ?? ""}\n\nFiles changed:${patchDigest(files)}`.trim(),
        author: {
          id: p.user ? String(p.user.id) : null,
          handle: p.user?.login ?? null,
          name: null,
          createdAt: null,
          followers: null,
        },
        github: github(`${owner}/${repo}`, {
          state: p.state,
          merged,
          mergedAt: p.merged_at,
          additions: p.additions,
          deletions: p.deletions,
          changedFiles: p.changed_files,
          files: files.map((f) => f.filename),
        }),
      },
    },
  };
}

/** resourceId "owner/repo@<40-hex sha>" */
export async function fetchGithubCommit(
  resourceId: string,
  opts: { token?: string; fetch?: Fetch; baseUrl?: string },
): Promise<FetchResult> {
  const m = /^([^/]+)\/([^@]+)@([0-9a-f]{40})$/.exec(resourceId);
  if (!m) throw new FetchError("Malformed commit id", false);
  const [, owner, repo, sha] = m;
  const usage: FetchResult["usage"] = [
    {
      provider: "github" as const,
      endpoint: "GET /repos/:o/:r/commits/:sha",
      units: 1,
      estCostUsd: 0,
    },
  ];
  const res = await get(`/repos/${owner}/${repo}/commits/${sha}`, opts);
  if (res.status === 404 || res.status === 422)
    return {
      outcome: { status: "not_found", detail: "The commit doesn't exist or isn't public." },
      usage,
    };
  if (!res.ok) throw new FetchError(`GitHub ${res.status}`, false, res.status);
  const c = Commit.safeParse(await res.json());
  if (!c.success) throw new FetchError("Unexpected GitHub response", false);
  const files = c.data.files ?? [];

  // F-05. GitHub serves any commit from the repository's fork network under the upstream URL, and commit dates are
  // set by whoever made the commit. So: the commit must be reachable from the default branch, and its date is when it
  // landed there (the merge time of the pull request that brought it in). A direct push has no provable landing time:
  // no date, so it goes to a person (DATE_UNVERIFIED); a commit not on the default branch is rejected (NOT_MERGED).
  const repoRes = await get(`/repos/${owner}/${repo}`, opts);
  const defaultBranch = repoRes.ok
    ? (RepoInfo.safeParse(await repoRes.json()).data?.default_branch ?? null)
    : null;
  let onDefaultBranch = false;
  if (defaultBranch) {
    const cmp = await get(
      `/repos/${owner}/${repo}/compare/${encodeURIComponent(defaultBranch)}...${sha}`,
      opts,
    );
    const status = cmp.ok ? CompareInfo.safeParse(await cmp.json()).data?.status : undefined;
    // "behind"/"identical": the default branch already contains this commit.
    onDefaultBranch = status === "behind" || status === "identical";
  }
  let landedAt: string | null = null;
  if (onDefaultBranch) {
    const prs = await get(`/repos/${owner}/${repo}/commits/${sha}/pulls`, opts);
    const list = prs.ok ? (PullsForCommit.safeParse(await prs.json()).data ?? []) : [];
    landedAt = list.find((p) => p.merged_at && p.base?.ref === defaultBranch)?.merged_at ?? null;
  }
  usage.push(
    { provider: "github", endpoint: "GET /repos/:o/:r", units: 1, estCostUsd: 0 },
    { provider: "github", endpoint: "GET /repos/:o/:r/compare", units: 1, estCostUsd: 0 },
    ...(onDefaultBranch
      ? [
          {
            provider: "github" as const,
            endpoint: "GET /repos/:o/:r/commits/:sha/pulls",
            units: 1,
            estCostUsd: 0,
          },
        ]
      : []),
  );

  return {
    usage,
    outcome: {
      status: "ok",
      resource: {
        sourceType: "github_commit",
        resourceId,
        url: c.data.html_url,
        timestamp: landedAt,
        timestampKind: landedAt ? "merged" : "unknown",
        title: c.data.commit.message.split("\n")[0] ?? null,
        text: `${c.data.commit.message}\n\nFiles changed:${patchDigest(files)}`.trim(),
        author: {
          id: c.data.author ? String(c.data.author.id) : null,
          handle: c.data.author?.login ?? null,
          name: c.data.commit.author?.name ?? null,
          createdAt: null,
          followers: null,
        },
        github: github(`${owner}/${repo}`, {
          state: onDefaultBranch ? `on ${defaultBranch}` : "not on the default branch",
          merged: onDefaultBranch,
          mergedAt: landedAt,
          additions: c.data.stats?.additions ?? 0,
          deletions: c.data.stats?.deletions ?? 0,
          changedFiles: files.length,
          files: files.map((f) => f.filename),
        }),
      },
    },
  };
}
