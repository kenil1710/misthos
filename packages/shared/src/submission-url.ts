import type { SourceType } from "./sources";

/**
 * Classify a pasted link into the one resource Misthos will fetch. We never crawl or search: the resource id is
 * derived from the URL alone, and it is also the dedupe key (same id = same work).
 */
export type ClassifiedUrl =
  | { ok: true; sourceType: SourceType; resourceId: string; canonicalUrl: string }
  | { ok: false; error: string };

const X_HOSTS = new Set([
  "x.com",
  "twitter.com",
  "mobile.twitter.com",
  "mobile.x.com",
  "www.x.com",
  "www.twitter.com",
]);
const GITHUB_HOSTS = new Set(["github.com", "www.github.com"]);
const TRACKING_PARAMS = /^(utm_[a-z]+|fbclid|gclid|mc_cid|mc_eid|ref|ref_src|s|t|si)$/i;
const UNSUPPORTED_HOSTS: Record<string, string> = {
  "t.co": "Paste the full link instead of a t.co short link.",
  "youtube.com": "YouTube videos aren't supported in this program.",
  "www.youtube.com": "YouTube videos aren't supported in this program.",
  "youtu.be": "YouTube videos aren't supported in this program.",
  "discord.com": "Discord messages aren't supported.",
  "discord.gg": "Discord messages aren't supported.",
};

function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[") || host.includes(":");
}

export function classifySubmissionUrl(input: string): ClassifiedUrl {
  const raw = input.trim();
  if (raw.length > 2000) return { ok: false, error: "That link is too long." };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: "Paste a full link starting with https://" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:")
    return { ok: false, error: "Only web links are supported." };
  if (url.username || url.password)
    return { ok: false, error: "Links with credentials aren't allowed." };
  const host = url.hostname.toLowerCase();
  if (UNSUPPORTED_HOSTS[host]) return { ok: false, error: UNSUPPORTED_HOSTS[host] };
  const parts = url.pathname.split("/").filter(Boolean);

  if (X_HOSTS.has(host)) {
    // /{handle}/status/{id} or /i/web/status/{id} or /i/status/{id}
    const i = parts.findIndex((p) => p === "status" || p === "statuses");
    const id = i >= 0 ? parts[i + 1] : undefined;
    if (!id || !/^\d{1,20}$/.test(id))
      return { ok: false, error: "That X link isn't a post. Open the post and copy its link." };
    return {
      ok: true,
      sourceType: "x_post",
      resourceId: id,
      canonicalUrl: `https://x.com/i/web/status/${id}`,
    };
  }

  if (GITHUB_HOSTS.has(host)) {
    const [owner, repo, kind, ref, sub, subRef] = parts;
    const valid = (s?: string) => !!s && /^[A-Za-z0-9_.-]{1,100}$/.test(s);
    if (!valid(owner) || !valid(repo))
      return { ok: false, error: "Link a pull request or a commit." };
    const o = owner!.toLowerCase();
    const r = repo!.toLowerCase();
    if (kind === "pull" && ref && /^\d{1,7}$/.test(ref)) {
      // /pull/{n}/commits/{sha} is a commit inside a PR
      if (sub === "commits" && subRef && /^[0-9a-f]{40}$/i.test(subRef)) {
        const sha = subRef.toLowerCase();
        return {
          ok: true,
          sourceType: "github_commit",
          resourceId: `${o}/${r}@${sha}`,
          canonicalUrl: `https://github.com/${o}/${r}/commit/${sha}`,
        };
      }
      return {
        ok: true,
        sourceType: "github_pr",
        resourceId: `${o}/${r}#${ref}`,
        canonicalUrl: `https://github.com/${o}/${r}/pull/${ref}`,
      };
    }
    if (kind === "commit" && ref && /^[0-9a-f]{40}$/i.test(ref)) {
      const sha = ref.toLowerCase();
      return {
        ok: true,
        sourceType: "github_commit",
        resourceId: `${o}/${r}@${sha}`,
        canonicalUrl: `https://github.com/${o}/${r}/commit/${sha}`,
      };
    }
    if (kind === "commit")
      return { ok: false, error: "Use the commit's full link (with the 40-character SHA)." };
    return { ok: false, error: "Link a pull request or a commit." };
  }

  // Articles: any other public web page.
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    isIpLiteral(host) ||
    !host.includes(".")
  ) {
    return { ok: false, error: "That address isn't a public web page." };
  }
  if (url.port && url.port !== "80" && url.port !== "443")
    return { ok: false, error: "That address isn't a public web page." };
  const params = [...url.searchParams.entries()]
    .filter(([k]) => !TRACKING_PARAMS.test(k))
    .sort(([a], [b]) => a.localeCompare(b));
  const query = params.length ? `?${new URLSearchParams(params).toString()}` : "";
  const path = url.pathname.replace(/\/+$/, "") || "";
  const canonical = `https://${host.replace(/^www\./, "")}${path}${query}`;
  return { ok: true, sourceType: "article", resourceId: canonical, canonicalUrl: canonical };
}
