import { describe, expect, it } from "vitest";
import { contributorNextSteps } from "@/lib/contributor-steps";

const handle = "alice";

describe("contributorNextSteps (tailored to the program's sources)", () => {
  it("X only: tells them to post from their handle", () => {
    const [first] = contributorNextSteps({
      sources: ["x_post"],
      xHandle: handle,
      githubConnected: false,
    });
    expect(first!.title).toBe("Post on X from @alice");
  });

  it("code only: never says to post on X; asks to connect GitHub first", () => {
    const steps = contributorNextSteps({
      sources: ["github_pr"],
      xHandle: handle,
      githubConnected: false,
    });
    const text = JSON.stringify(steps);
    expect(text).not.toMatch(/Post on X|post from @/);
    expect(steps[0]!.title).toBe("Connect GitHub, then ship code");
    expect(steps[0]!.body).toMatch(/merged pull request/);
  });

  it("code, already connected", () => {
    const [first] = contributorNextSteps({
      sources: ["github_pr", "github_commit"],
      xHandle: handle,
      githubConnected: true,
    });
    expect(first!.title).toBe("Ship code on GitHub");
    expect(first!.body).toMatch(/merged pull request or a commit/);
  });

  it("articles: must mention the handle", () => {
    const [first] = contributorNextSteps({
      sources: ["article"],
      xHandle: handle,
      githubConnected: false,
    });
    expect(first!.title).toBe("Publish an article");
    expect(first!.body).toMatch(/@alice/);
  });

  it("several sources: one line per kind of work", () => {
    const [first] = contributorNextSteps({
      sources: ["x_post", "github_pr", "article"],
      xHandle: handle,
      githubConnected: false,
    });
    expect(first!.items).toHaveLength(3);
    expect(first!.items![0]).toMatch(/^X posts: post from @alice/);
    expect(first!.items![1]).toMatch(/^GitHub: connect GitHub/);
    expect(first!.items![2]).toMatch(/^Articles: .*@alice/);
  });
});
