import { parseMustInclude } from "@misthos/shared/context";

/** The context as typed: lists are one item per line, "must include" is comma or space separated. */
export type UnderstandingDraft = {
  summary: string;
  keyFacts: string;
  onTopic: string;
  offTopic: string;
};
export type ContextSourceView = {
  url: string;
  ok: boolean;
  title?: string | null;
  note?: string | null;
};
export type ContextDraft = {
  about: string;
  links: string;
  mustInclude: string;
  readId: string | null;
  understanding: UnderstandingDraft | null;
  sources: ContextSourceView[];
};

export const emptyContextDraft = (): ContextDraft => ({
  about: "",
  links: "",
  mustInclude: "",
  readId: null,
  understanding: null,
  sources: [],
});

export const ABOUT_PLACEHOLDER =
  "Arc is Circle's stablecoin-native Layer 1: gas is paid in USDC and blocks are final in under a second. We want builders to show what they ship on Arc: tutorials, threads that explain how something works, and pull requests to arc-builders repositories.\n\nPost about: building on Arc, USDC gas, Circle wallets and Gateway, payments apps.\nAvoid: token price talk, airdrop farming, memes, and AI-written summaries of our docs.";

const lines = (s: string) =>
  s
    .split("\n")
    .map((l) => l.replace(/^[-•*]\s*/, "").trim())
    .filter(Boolean);

/** The payload for the API (ContextSaveInput). */
export function contextPayload(d: ContextDraft) {
  return {
    about: d.about,
    links: lines(d.links.replace(/,/g, "\n")),
    mustInclude: parseMustInclude(d.mustInclude),
    readId: d.readId,
    understanding: d.understanding
      ? {
          summary: d.understanding.summary.trim(),
          keyFacts: lines(d.understanding.keyFacts),
          onTopic: lines(d.understanding.onTopic),
          offTopic: lines(d.understanding.offTopic),
        }
      : null,
  };
}

type Understanding = { summary: string; keyFacts: string[]; onTopic: string[]; offTopic: string[] };
export const toDraftUnderstanding = (u: Understanding): UnderstandingDraft => ({
  summary: u.summary,
  keyFacts: u.keyFacts.join("\n"),
  onTopic: u.onTopic.join("\n"),
  offTopic: u.offTopic.join("\n"),
});
