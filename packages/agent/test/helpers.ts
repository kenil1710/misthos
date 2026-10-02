import type Anthropic from "@anthropic-ai/sdk";
import { Rubric, type RubricCategory } from "@misthos/shared";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { vi } from "vitest";
import type { MessagesClient } from "../src/judge";

const dir = fileURLToPath(new URL("./fixtures/", import.meta.url));
export const fixtureText = (p: string) => readFileSync(dir + p, "utf8");
export const fixture = <T = unknown>(p: string): T => JSON.parse(fixtureText(p)) as T;

export const RUBRIC = Rubric.parse({
  generalRules: "English only. No giveaways or engagement bait.",
  categories: [
    {
      key: "threads",
      name: "Threads",
      description: "Original educational threads about Arc",
      sourceTypes: ["x_post"],
      maxPoints: 10,
      criteria: [
        { key: "depth", name: "Depth", description: "Explains how and why" },
        { key: "clarity", name: "Clarity", description: "Easy to follow" },
        { key: "originality", name: "Originality", description: "Not a rewrite" },
      ],
    },
    {
      key: "pull_requests",
      name: "Pull requests",
      description: "Code contributions to Arc builder repos",
      sourceTypes: ["github_pr", "github_commit"],
      maxPoints: 20,
      requireMerged: true,
      criteria: [
        { key: "impact", name: "Impact", description: "Fixes a real problem" },
        { key: "quality", name: "Quality", description: "Readable and tested" },
      ],
    },
    {
      key: "articles",
      name: "Articles",
      description: "Long-form writing about building on Arc",
      sourceTypes: ["article"],
      maxPoints: 15,
      criteria: [
        { key: "depth", name: "Depth", description: "Goes beyond the docs" },
        { key: "accuracy", name: "Accuracy", description: "Technically correct" },
      ],
    },
  ],
});
export const CATEGORIES: RubricCategory[] = RUBRIC.categories;

/** fetch() that serves JSON fixtures by URL substring; unknown URLs 404. Records calls. */
export function fixtureFetch(
  routes: Record<string, { status?: number; json?: unknown; headers?: Record<string, string> }>,
) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    const hit = Object.entries(routes).find(([k]) => url.includes(k));
    if (!hit) return new Response("{}", { status: 404 });
    const { status = 200, json, headers } = hit[1];
    return new Response(JSON.stringify(json ?? {}), {
      status,
      headers: { "content-type": "application/json", ...headers },
    });
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

/** Fake messages client replaying saved responses in order (last one repeats). */
export function fakeClaude(...names: string[]) {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  let i = 0;
  const client: MessagesClient = {
    create: (async (params: Anthropic.MessageCreateParamsNonStreaming) => {
      calls.push(params);
      const name = names[Math.min(i++, names.length - 1)]!;
      return fixture<Anthropic.Message>(`anthropic/${name}.json`);
    }) as unknown as MessagesClient["create"],
  };
  return { client, calls };
}
