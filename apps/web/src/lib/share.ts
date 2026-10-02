import { formatUsdc, SOURCE_LABELS, type SourceType } from "@misthos/shared";

/** A ready-made X post announcing a program: name, what it pays for and up to how much, and the join link. */
export function shareOnXUrl(p: {
  name: string;
  joinUrl: string;
  sources: SourceType[];
  bestPayout: bigint;
}): string {
  const what = p.sources
    .map((t) => SOURCE_LABELS[t].replace(/^(?!X )./, (c) => c.toLowerCase()))
    .join(", ");
  const text = `${p.name} pays contributors in USDC on Arc for ${what}, up to ${formatUsdc(p.bestPayout)} per piece. An AI agent reviews every submission and explains its decision. Join:`;
  const url = new URL("https://x.com/intent/post");
  url.searchParams.set("text", text);
  url.searchParams.set("url", p.joinUrl);
  return url.toString();
}
