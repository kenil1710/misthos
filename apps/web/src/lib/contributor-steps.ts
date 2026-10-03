import type { SourceType } from "@misthos/shared/sources";

export interface NextStep {
  title: string;
  /** One line per accepted source when the program pays for several kinds of work. */
  items?: string[];
  body?: string;
}

/** What one kind of work takes to count, in the contributor's terms (matches what the agent checks). */
function howTo(
  t: "x" | "github" | "article",
  p: { xHandle: string; githubConnected: boolean; commits: boolean; prs: boolean },
) {
  if (t === "x") return `X posts: post from @${p.xHandle}. Only posts from that account count.`;
  if (t === "article")
    return `Articles: publish it anywhere public and mention or link @${p.xHandle} in it, so the agent can confirm it's yours.`;
  const what =
    p.prs && p.commits
      ? "a merged pull request or a commit"
      : p.prs
        ? "a merged pull request"
        : "a commit";
  return p.githubConnected
    ? `GitHub: ${what} to a public repository, authored by your connected GitHub account.`
    : `GitHub: connect GitHub below first (read-only), then ${what} to a public repository.`;
}

/**
 * The first-run checklist on a contributor's page, tailored to what the program pays for: X posts from their
 * handle, GitHub work from their connected account, articles that mention their handle.
 */
export function contributorNextSteps(p: {
  sources: readonly SourceType[];
  xHandle: string;
  githubConnected: boolean;
}): NextStep[] {
  const prs = p.sources.includes("github_pr");
  const commits = p.sources.includes("github_commit");
  const kinds = [
    ...(p.sources.includes("x_post") ? (["x"] as const) : []),
    ...(prs || commits ? (["github"] as const) : []),
    ...(p.sources.includes("article") ? (["article"] as const) : []),
  ];
  const ctx = { xHandle: p.xHandle, githubConnected: p.githubConnected, prs, commits };
  const first: NextStep =
    kinds.length === 1
      ? kinds[0] === "x"
        ? {
            title: `Post on X from @${p.xHandle}`,
            body: "Write a post or thread this program pays for. Only posts from that account count.",
          }
        : kinds[0] === "article"
          ? {
              title: "Publish an article",
              body: `Publish it anywhere public and mention or link @${p.xHandle} in it, so the agent can confirm it's yours.`,
            }
          : {
              title: p.githubConnected ? "Ship code on GitHub" : "Connect GitHub, then ship code",
              body: howTo("github", ctx)
                .replace(/^GitHub: /, "")
                .replace(/^./, (c) => c.toUpperCase()),
            }
      : { title: "Create something this program pays for", items: kinds.map((k) => howTo(k, ctx)) };
  return [
    first,
    {
      title: "Paste the link below",
      body: "The agent checks it's yours, original and inside the round, scores it and tells you why, usually within a minute.",
    },
    {
      title: "Get paid when the round closes",
      body: "Approved work is paid in USDC to your payout wallet. Every payout is public.",
    },
  ];
}
